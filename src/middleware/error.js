function notFound(req, res, next) {
  res.status(404).json({ message: `Not found: ${req.originalUrl.split('?')[0]}` });
}

function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  let errors;
  if (err.name === 'ValidationError') {
    status = 400;
    errors = Object.fromEntries(Object.entries(err.errors || {}).map(([k, e]) => [k, e.message]));
    message = Object.values(errors).join(' ') || message;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field ? `That ${field} is already in use.` : 'A record with that value already exists.';
  } else if (err.name === 'VersionError') {
    status = 409;
    message = 'This record was changed by someone else. Reload and try again.';
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid id.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large.';
  }
  if (status >= 500) {
    console.error(err);
    // Internal error text (DB errors, provider responses) is not for clients.
    if (process.env.NODE_ENV === 'production') message = 'Something went wrong. Please try again.';
  }
  res.status(status).json({ message, errors });
}

module.exports = { notFound, errorHandler };
