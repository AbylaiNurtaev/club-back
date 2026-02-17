const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema(
  {
    logoUrl: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('CompanySettings', companySettingsSchema);

