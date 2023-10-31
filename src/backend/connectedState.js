class ConnectedState {
    // Private Fields
    static #_IDLE = -1;
    static #_NOT_CONNECTED = 0;
    static #_REST_API_CONNECTING = 1;
    static #_REST_API_CONNECTED = 2;
    static #_WEBSOCKET_OPEN = 3;
    static #_CONNECTED = 4;

    // Accessors for "get" functions only (no "set" functions)
    static get IDLE() { return this.#_IDLE; }
    static get NOT_CONNECTED() { return this.#_NOT_CONNECTED; }
    static get REST_API_CONNECTING() { return this.#_REST_API_CONNECTING; }
    static get REST_API_CONNECTED() { return this.#_REST_API_CONNECTED; }
    static get WEBSOCKET_OPEN() { return this.#_WEBSOCKET_OPEN; }
    static get CONNECTED() { return this.#_CONNECTED; }
}
module.exports = ConnectedState
