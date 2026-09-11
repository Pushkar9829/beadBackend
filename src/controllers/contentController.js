const SiteContent = require('../models/SiteContent');
const { mergeHomeContent } = require('../data/homeContent');
const { asyncHandler } = require('../utils/asyncHandler');

exports.get = asyncHandler(async (_req, res) => {
  const stored = await SiteContent.findOne({ key: 'main' }).lean();
  res.json({ content: mergeHomeContent(stored) });
});
