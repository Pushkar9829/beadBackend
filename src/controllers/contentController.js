const SiteContent = require('../models/SiteContent');
const { asyncHandler } = require('../utils/asyncHandler');

exports.get = asyncHandler(async (_req, res) => {
  const content = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content });
});
