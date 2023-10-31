/**
 * @file Node to handle EWIO2 analog outputs.
 * @author Metz Connect
 */

/**
 * ewio2 analog output node namespace.
 * @namespace AnalogOutNode
 */

module.exports = function(RED) {
    /**
    * Stores settings from analog OUT configuration menu.
    * Checks if all required settings are available, otherwise shows error status.
    * If a input message is received, connection to EWIO2 is established and analog OUT is set.
    * If the node is restarted, disable or deleted, this node is deregistered from registed nodes of ewio2Connections map.
    * @memberof AnalogOutNode
    * @param {Object} config - analog OUT settings from analog OUT menu (frontend).
    */
    function EwioAnalogOutputsNode(config) {
        const MD5 = require("crypto-js/md5");
        const {log, pubSub} = require("./backend/general");
        RED.nodes.createNode(this,config);

        this.ewio2 = config.ewio2;
        this.name = config.name;
        this.ioportAo = config.ioportAo;
        this.value = config.value;
        this.manualMode = config.manualMode;

        let node = this;
        log(node, 'create node');
        log(node, 'ewio2 ID: ' + JSON.stringify(this.ewio2, null, 4));
        this.status({});
        if(this.ewio2 === "") {
            log(node, 'no EWIO2 selected');
            this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingEwio"});
        }
        else {
            const configNode = RED.nodes.getNode(this.ewio2);
            if(!configNode) {
                log(node, 'no EWIO2 (deactivated?)');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.configNodeMissing"});
            }
            else if(configNode.host === "") {
                log(node, 'no host selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingHost"});
            }
            else if(configNode.credentials.username === "") {
                log(node, 'no username selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingUser"});
            }
            else if(configNode.credentials.password === "") {
                log(node, 'no password selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingPw"});
            }
            else if(configNode.encryption === "") {
                log(node, 'no encryption selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingEnc"});
            }
            else {
                const configNodeTls = RED.nodes.getNode(configNode.tlsConfig);
                log(node, 'host: ' + JSON.stringify(configNode.host, null, 4));
                log(node, 'user: ' + JSON.stringify(configNode.credentials.username, null, 4));
                log(node, 'pw: ' + JSON.stringify(configNode.credentials.password, null, 4));
                log(node, 'enc: ' + JSON.stringify(configNode.encryption, null, 4));

                var configData = {configNodeId: this.ewio2, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption};

                // same function name as in other nodes (pubSub in ewio2Connection.js publishes general errors to all nodes)
                function showStatus(status) {
                    log(node, 'AO recv ioport: ' + status.addr + '; ioport: ' + this.ioportAo + '; node.id: ' + node.id + '; this.ewio2: ' + this.ewio2 + '; status.configNodeId: ' + status.configNodeId + "; msg: " + status.message);
                    // selected EWIO2 configuration node ID is equal to received (from EWIO2 livechannel or from ewio2Connections map) EWIO2 configuration node ID (for this node)
                    if (config.ewio2 == status.configNodeId) {
                        log(node, 'updated nodeID: ' + node.id);
                        node.status({fill: status.color, shape: status.shape, text: status.message});
                    }
                }
                log(node, 'subscribe "show-status": ' + node.id);
                pubSub.subscribe("show-status", showStatus);

                // handles analog OUT errors received from pubSub in ewio2Connection.js and shows status by calling showStatus fct above (in analog-outputs.js)
                function showStatusAo(status) {
                    // received IO port (from EWIO2 livechannel or from ewio2Connections map) is equal to selected IO port (for this node)
                    // received IO port may be empty for errors not related to an IO (e.g. "wrong credentials")
                    if (status.addr && config.ioportAo) {
                        if (status.addr === config.ioportAo) {
                            showStatus(status);
                        }
                    }
                }
                pubSub.subscribe("show-status-ao", showStatusAo);

                node.on('input', async function(msg, send, done) {
                    const {setValue} = require("./backend/ewio2Connection");
                    log(node, 'msg: ' + JSON.stringify(msg.payload, null, 4));
                    log(node, 'typeof msg.payload: ' + JSON.stringify(typeof msg.payload, null, 4));
                    if (typeof msg.payload === "number") {
                        // keep boolean true / false and convert number equal 0 -> false / number > 0 or < 0 -> true
                        log(node, 'msg.payload: ' + msg.payload);
                        const settedValue = await setValue(configData, msg.payload, "ao", this.ioportAo, node.id, RED, "setValue", configNodeTls);
                        log(node, 'ao setValue ' + settedValue + ' DONE ' + node.id);
                        // on error (undefined) --> send undefinded. Otherwise send number value
                        var msg = { payload: settedValue ? (Number(settedValue)) : settedValue };
                        node.send(msg);
                    }
                    else {
                        log(node, 'msg.payload WRONG TYPE');
                        pubSub.publish("show-status-ao", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noNumber", "configNodeId": this.ewio2, "addr": this.ioportAo});
                    }
                    if (done) {
                        done();
                    }
                });
                node.on("close", function(done) {
                    const {deregisterNode} = require("./backend/ewio2Connection");
                    log(node, 'node disabled / deleted / restarted -> unsubscribe "show-status": ' + node.id);
                    pubSub.unsubscribe("show-status");
                    pubSub.unsubscribe("show-status-ao");
                    log(node, 'node disabled / deleted -> deregister from websocket connection": ' + node.id);
                    const userData = {configNodeId: configNode.id, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption};
                    deregisterNode( function () {
                        log(node, 'callback deregisterNode fct DONE');
                        done();
                    }, userData, node.id, RED);
                });
            }
        }
    }
    RED.nodes.registerType("EWIO2 - Analog OUT",EwioAnalogOutputsNode);
}
 
 
