/**
 * Синхронизация выигрыша баллов (рулетка) с депозитом клиента в SmartShell Billing (GraphQL).
 *
 * Переменные окружения (все обязательны для включения синхронизации):
 * - SMARTSHELL_LOGIN
 * - SMARTSHELL_PASSWORD
 * - SMARTSHELL_COMPANY_ID (число, например 9735)
 * Опционально:
 * - SMARTSHELL_BILLING_URL (по умолчанию https://billing.smartshell.gg/api/graphql)
 */

const DEFAULT_GRAPHQL_URL = 'https://billing.smartshell.gg/api/graphql';

let tokenCache = { accessToken: null, expiresAt: 0 };

function escapeGraphQLString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isSmartShellBillingConfigured() {
  const login = process.env.SMARTSHELL_LOGIN;
  const password = process.env.SMARTSHELL_PASSWORD;
  const companyId = process.env.SMARTSHELL_COMPANY_ID;
  return Boolean(
    login && String(login).trim()
    && password && String(password).trim()
    && companyId !== undefined && String(companyId).trim() !== ''
  );
}

/** Нормализация телефона для сопоставления с полем phone в SmartShell (только цифры, 8→7 для РФ/КЗ). */
function normalizePhoneDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') {
    d = `7${d.slice(1)}`;
  }
  if (d.length === 10) {
    d = `7${d}`;
  }
  return d;
}

function getGraphqlUrl() {
  return (process.env.SMARTSHELL_BILLING_URL || DEFAULT_GRAPHQL_URL).trim();
}

async function postGraphql(query, bearerToken) {
  const url = getGraphqlUrl();
  const headers = { 'Content-Type': 'application/json' };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    const err = new Error(`SmartShell: ответ не JSON, HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`SmartShell HTTP ${res.status}: ${JSON.stringify(json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function fetchAccessToken() {
  const login = String(process.env.SMARTSHELL_LOGIN || '').trim();
  const password = String(process.env.SMARTSHELL_PASSWORD || '').trim();
  const companyId = parseInt(process.env.SMARTSHELL_COMPANY_ID, 10);
  if (!login || !password || Number.isNaN(companyId)) {
    throw new Error('SmartShell: задайте SMARTSHELL_LOGIN, SMARTSHELL_PASSWORD и SMARTSHELL_COMPANY_ID');
  }

  const query = `mutation { login(input: { login: "${escapeGraphQLString(login)}", password: "${escapeGraphQLString(password)}", company_id: ${companyId} }) { access_token expires_in } }`;
  const json = await postGraphql(query, null);

  if (json.errors && json.errors.length) {
    throw new Error(`SmartShell login: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  const accessToken = json?.data?.login?.access_token;
  if (!accessToken) {
    throw new Error(`SmartShell login: нет access_token в ответе: ${JSON.stringify(json)}`);
  }

  const expiresInSec = Number(json?.data?.login?.expires_in) || 86400;
  const marginMs = 60_000;
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000 - marginMs,
  };
  return accessToken;
}

async function getValidAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  return fetchAccessToken();
}

async function graphqlAuthorized(query) {
  const tryOnce = async () => {
    const token = await getValidAccessToken();
    return postGraphql(query, token);
  };

  try {
    let json = await tryOnce();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '));
    }
    return json;
  } catch (e) {
    if (e.status === 401) {
      tokenCache = { accessToken: null, expiresAt: 0 };
      const json = await tryOnce();
      if (json.errors && json.errors.length) {
        throw new Error(json.errors.map((err) => err.message).join('; '));
      }
      return json;
    }
    throw e;
  }
}

async function fetchClients() {
  const query = 'query { clients { data { uuid phone nickname deposit } } }';
  const json = await graphqlAuthorized(query);
  const list = json?.data?.clients?.data;
  if (!Array.isArray(list)) {
    throw new Error(`SmartShell clients: неожиданный ответ: ${JSON.stringify(json?.data)}`);
  }
  return list;
}

function findClientByPhone(clients, playerPhone) {
  const target = normalizePhoneDigits(playerPhone);
  if (!target) return null;
  return (
    clients.find((c) => normalizePhoneDigits(c.phone) === target)
    || clients.find((c) => normalizePhoneDigits(c.nickname) === target)
    || null
  );
}

/**
 * Увеличивает депозит клиента в SmartShell на сумму выигрыша (текущий deposit + delta).
 * @param {string} playerPhone — телефон игрока (как в нашей БД)
 * @param {number} delta — начисление в тех же единицах, что и value приза (баллы)
 */
async function syncPrizePointsToSmartshellDeposit(playerPhone, delta) {
  if (!isSmartShellBillingConfigured()) {
    return { ok: true, skipped: true, reason: 'smartshell_not_configured' };
  }

  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: true, skipped: true, reason: 'invalid_or_zero_amount' };
  }

  const clients = await fetchClients();
  const client = findClientByPhone(clients, playerPhone);
  if (!client || !client.uuid) {
    const msg = `[smartshell] клиент не найден по телефону: ${playerPhone} (нормализовано: ${normalizePhoneDigits(playerPhone)})`;
    console.warn(msg);
    return { ok: false, reason: 'client_not_found', phone: playerPhone };
  }

  const current = Number(client.deposit);
  const base = Number.isFinite(current) ? current : 0;
  const newValue = base + amount;

  const uuid = escapeGraphQLString(client.uuid);
  const mutation = `mutation { setDeposit(input: { client_uuid: "${uuid}", value: ${newValue} }) { id login nickname } }`;
  const json = await graphqlAuthorized(mutation);

  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }

  const setData = json?.data?.setDeposit;
  if (!setData) {
    throw new Error(`SmartShell setDeposit: пустой ответ: ${JSON.stringify(json)}`);
  }

  return {
    ok: true,
    clientUuid: client.uuid,
    previousDeposit: base,
    newDeposit: newValue,
    setDeposit: setData,
  };
}

module.exports = {
  isSmartShellBillingConfigured,
  normalizePhoneDigits,
  syncPrizePointsToSmartshellDeposit,
};
