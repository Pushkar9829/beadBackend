function notFound(req, res, next) {
  res.status(404).json({ message: `Not found: ${req.originalUrl}` });
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors || {}).map((e) => e.message).join(' ') || message;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field ? `That ${field} is already in use.` : 'A record with that value already exists.';
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid id.';
  }
  res.status(status).json({
    message,
    errors: err.errors || undefined,
  });
}

module.exports = { notFound, errorHandler };
