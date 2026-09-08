const dns = require('dns');
const { Resolver } = require('dns').promises;
const mongoose = require('mongoose');

function publicResolver() {
  const resolver = new Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1']);
  return resolver;
}

async function srvToStandard(srvUri) {
  const parsed = new URL(srvUri.replace(/^mongodb\+srv:\/\//i, 'https://'));
  const hostname = parsed.hostname;
  const resolver = publicResolver();
  const [srv, txt] = await Promise.all([
    resolver.resolveSrv(`_mongodb._tcp.${hostname}`),
    resolver.resolveTxt(hostname).catch(() => []),
  ]);

  const hosts = srv.map((r) => `${r.name}:${r.port || 27017}`).join(',');
  const auth = parsed.username
    ? `${encodeURIComponent(decodeURIComponent(parsed.username))}:${encodeURIComponent(decodeURIComponent(parsed.password || ''))}@`
    : '';
  const dbPath = parsed.pathname || '/';
  const params = new URLSearchParams(parsed.search);
  String((txt || []).flat().join('&'))
    .split('&')
    .filter(Boolean)
    .forEach((pair) => {
      const [key, value] = pair.split('=');
      if (key && value && !params.has(key)) params.set(key, value);
    });
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  if (!params.has('authSource')) params.set('authSource', 'admin');
  return `mongodb://${auth}${hosts}${dbPath}?${params.toString()}`;
}

async function connectDb() {
  let uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/kuberstones';
  mongoose.set('strictQuery', true);
  dns.setDefaultResultOrder('ipv4first');

  const opts = { family: 4, serverSelectionTimeoutMS: 20000 };

  if (/^mongodb\+srv:\/\//i.test(uri)) {
    uri = await srvToStandard(uri);
  }

  await mongoose.connect(uri, opts);
  console.log('MongoDB connected');
}

module.exports = { connectDb };
