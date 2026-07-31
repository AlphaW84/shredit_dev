"use strict";

const http = require("node:http");

const INTERNAL_PEER_HEADER = "x-shredit-runtime-peer";
const PATCH_MARKER = Symbol.for("shredit.injectPeerAddress");

function socketPeerAddress(request) {
  const value = request?.socket?.remoteAddress;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || /[\r\n]/u.test(trimmed)) return null;
  return trimmed;
}

function replaceRawHeader(request, value) {
  if (!Array.isArray(request?.rawHeaders)) return;
  const sanitized = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    if (typeof name === "string" && name.toLowerCase() === INTERNAL_PEER_HEADER)
      continue;
    sanitized.push(name, request.rawHeaders[index + 1]);
  }
  if (value !== null) sanitized.push(INTERNAL_PEER_HEADER, value);
  request.rawHeaders.splice(0, request.rawHeaders.length, ...sanitized);
}

function injectPeerAddress(request) {
  const value = socketPeerAddress(request);
  replaceRawHeader(request, value);
  if (!request?.headers || typeof request.headers !== "object") return;
  delete request.headers[INTERNAL_PEER_HEADER];
  if (value !== null) request.headers[INTERNAL_PEER_HEADER] = value;
}

if (!http.Server.prototype[PATCH_MARKER]) {
  const originalEmit = http.Server.prototype.emit;
  Object.defineProperty(http.Server.prototype, PATCH_MARKER, { value: true });
  http.Server.prototype.emit = function emitWithPeerAddress(event, ...args) {
    if (event === "request" || event === "upgrade") injectPeerAddress(args[0]);
    return originalEmit.call(this, event, ...args);
  };
}

module.exports = { INTERNAL_PEER_HEADER, injectPeerAddress, socketPeerAddress };
