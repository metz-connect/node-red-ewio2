/**
 * @file General library used for logging and publish-subscribe mechanism.
 * @author Metz Connect
 */

/**
 * General namespace.
 * @namespace General
 */

/**
 * Flag to write logs to syslog.
 * @memberof General
 * @type {bool}
 */
var DEBUG_LOGS = false;

/**
 * Logs messages to Node-RED logging interface (which is forwarded to syslog on EWIO2) or to console.
 * @memberof General
 * @param {Object} node - The current node, for which a log message should be written.
 * @param {string} msg - The log message.
 */
function log(node, msg) {
    // debug logs enabled
    if (DEBUG_LOGS) {
        // use Node-RED logging function if a node is available
        if (node) {
            node.log(msg);
        }
        // no node available, write log to console
        else {
            console.log(msg);
        }
    }
}

/**
 * Checks if debug logging is enabled or not.
 * @memberof General
 * @return {bool} Backend debug logs enabled flag (true = enabled).
 */
function getLogEnable() {
    return DEBUG_LOGS;
}

/**
 * Enables or disables syslog logging.
 * @memberof General
 * @param {bool} enableFlag - Logfile enable flag (true = enable).
 */
function setLogfileSettings(enableFlag) {
    DEBUG_LOGS = enableFlag;
}

/**
 * Publish, subscribe element, to publish status (show-status).
 * @memberof General
 * @type {Object}
 */
const pubSub = publishSubscribe();

/**
 * Publish and subscribe functionality: registers (subscribes) callback functions to subscribers object and executes all registered callback functions when message is published. Unsubscribes callback functions from subscribers object.
 * @memberof General
 * @return {function} Publish function to execute callback function, subscribe function to register callback function and unsubscribe function to deregister callback.
 */
function publishSubscribe() {
    const subscribers = {};

    function publish(eventName, data) {
        if (!Array.isArray(subscribers[eventName])) {
            return;
        }
        subscribers[eventName].forEach((callback) => {
            callback(data);
        })
    }

    function subscribe(eventName, callback) {
        if (!Array.isArray(subscribers[eventName])) {
            subscribers[eventName] = [];
        }
        subscribers[eventName].push(callback);
    }

    function unsubscribe(eventName) {
        const index = subscribers[eventName].length - 1;
        subscribers[eventName].splice(index, 1);
    }

    return {
        publish,
        subscribe,
        unsubscribe,
    }
}

/**
 * Enables or disables syslog logging.
 * @memberof General
 * @param {Object} status - Status object with all elements required for node´s status.
 * @param {Object} node - The current node, for which the status should be sent.
 * @param {Object} RED - Node-RED "infrastructure", used to get status messages according keyword.
 */
function sendStatusOutput(status, node, RED) {
    // prepare status msg that is send
    var nodeState;
    if (status.color === "green") {
        nodeState = "ok";
    }
    else if (status.color === "yellow") {
        nodeState = "warning";
    }
    else {
        nodeState = "error";
    }
    // send status msg to node output
    node.send({status:{state: nodeState, text: RED._(status.message), source:{id: node.id, type: node.type, name: node.name}}});
}

module.exports = { log, getLogEnable, setLogfileSettings, pubSub, sendStatusOutput }
