/*
 * Async bootstrap — required by Module Federation so that `shared`
 * dependencies (react, react-dom, etc.) can be negotiated with the host
 * before any module that imports them is evaluated.
 */
import("./index");
export {};
