function notFound(req, res, next) {
  res.status(404).json({ message: `Not found: ${req.originalUrl}` });
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: err.message || 'Something went wrong.',
    errors: err.errors || undefined,
  });
}

module.exports = { notFound, errorHandler };
