/**
 * @file Configuration node to handle EWIO2 settings and connection to EWIO2.
 * @author Metz Connect
 */

/**
 * ewio2 config node namespace.
 * @namespace Ewio2ConfigNode
 */

const dgram = require("dgram");
const os = require("os");
const ewioConnFile = require("./backend/ewio2Connection");
const {log, pubSub} = require("./backend/general");

const MESSAGE = Buffer.from("EWIO2?");
const MESSAGE2 = Buffer.from("EWIO2!");
const PORT = 1030;
const BROADCAST_ADDR = "255.255.255.255";

module.exports = function(RED) {
    /**
    * Stores settings from EWIO2 configuration menu.
    * Closes websocket connection to EWIO2, if EWIO2 configuration node is disabled or deleted.
    * @memberof Ewio2ConfigNode
    * @param {Object} config - EWIO2 config settings from EWIO2 configuratoin menu (frontend).
    */
    function EwioConfigNode(config) {
        RED.nodes.createNode(this,config);
        this.name = config.name;
        this.host = config.host;
        this.hostTemp = config.hostTemp;
        this.encryption = config.encryption;
        this.tlsConfig = config.tlsConfig;

        let node = this;
        node.on("close", function(removed, done) {
            const MD5 = require("crypto-js/md5");
            // node deleted or deactivated --> close and delete websocket
            if (removed) {
                log(node, 'EWIO2 config node disabled / deleted -> close websocket connection AND delete ewio2Connections entry: ' + node.id);
                const userData = {configNodeId: node.id, host: node.host, user: node.credentials.username, pw: MD5(node.credentials.password), enc: node.encryption};
                ewioConnFile.closeDeleteWebsocket( function () {
                    log(node, 'callback closeDeleteWebsocket fct DONE');
                    done();
                }, userData, RED);
            }
            // node restarted
            else {
                done();
            }
        });
    }
    RED.nodes.registerType("EWIO2",EwioConfigNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });

    /**
    * Send static files to frontend.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.get("/get/ewio2/scripts/*", function (req, res) {
        var options = {
            root: __dirname + "/frontend/",
            dotfiles: "deny"
        };
        res.sendFile(req.params[0], options);
    });

    /**
    * Receives discovery http post from frontend and starts discovery function.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/get/ewio2/discovery", RED.auth.needsPermission("ewio2.write"), function (req, res) {
        discoverEwios(req.body);
        res.sendStatus(200);
    });

    /**
    * Sends the two discovery messages to broadcast address of all available network interfaces.
    * Handles received discovery answers, wait 3s before the results are sorted. As last step the results are send to frontend.
    * @memberof Ewio2ConfigNode
    * @param {Object} idStrings - info strings (in selected browser language) of the current EWIO2, e.g. "noInfo" and "thisDevice".
    */
    async function discoverEwios(idStrings) {
        const discovery = require("./backend/discovery");

        const netAddr = discovery.getNetworkInterfaceAddresses(os.networkInterfaces());
        let ewioData = [];
        let sockets = [];
        // start broadcast for the address of current network interface
        netAddr.forEach(function(localAddress) {
            let socket = dgram.createSocket("udp4");
            sockets.push(socket);
            socket.bind(0, localAddress, function () {
                socket.setBroadcast(true);
                socket.send(MESSAGE, 0, MESSAGE.length, PORT, BROADCAST_ADDR);
                socket.send(MESSAGE2, 0, MESSAGE2.length, PORT, BROADCAST_ADDR);
            });
            socket.on("message", function (message, remote) {
                ewioData = discovery.handleReceivedMessage(message, remote, ewioData);
            });
        });
        await discovery.waitForTimeout();
        sockets.forEach(function(sock) {
            sock.close();
        });
        ewioData = discovery.sortResults(ewioData);
        // send array with found EWIO2 as response
        RED.comms.publish("publish/ewio2/discovered", JSON.stringify( { data: ewioData, infoStrings: idStrings } ));
    }

    /**
    * Checks if model string file is available in file system. This is needed to decide if Node-RED is running on EWIO2 or on PC.
    * Closes websocket connection to EWIO2, if EWIO2 configuration node is disabled or deleted.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/get/ewio2/model", RED.auth.needsPermission("ewio2.write"), function (req, res) {
        const fs = require('fs');
        var ewioModel;
        try {
            // Node-RED running on EWIO2 (/var/etc/info/ewio2_model.info available)
            ewioModel = fs.readFileSync("/var/etc/info/ewio2_model.info", {encoding: 'utf-8'});
        }
        catch (err) {
            // Node-RED running on Win or Linux PC (/var/etc/info/ewio2_model.info not available)
            ewioModel = "";
        }
        res.send(ewioModel);
    });

    /**
    * Receives get settings http get request from frontend and returns settings.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.get("/get/ewio2/settings", RED.auth.needsPermission("ewio2.write"), function (req, res) {
        const {getLogEnable} = require("./backend/general");
        const logSettings = {enable: getLogEnable()};
        res.send(logSettings);
    });

    /**
    * Receives settings http post request from frontend and stores settings.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/put/ewio2/settings", RED.auth.needsPermission("ewio2.write"), function (req, res) {
        const {setLogfileSettings} = require("./backend/general");
        //                               convert string to bool
        setLogfileSettings((req.body.enable == "true"));
        res.sendStatus(200);
    });

    /**
    * Backend functionality to get config data from EWIO2 and send them to frontend, to show in configuration menu.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/get/ewio2/configdata/:iotype/:prevIoPort/:nodeId/:counterId", RED.auth.needsPermission("ewio2.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.nodeId);

        log(node, "get config data backend reached");
        let userData;
        // decide between frontend and backend user data, or a combination
        if (RED.nodes.getNode(req.body.data.configNodeId)) {
            userData = ewioConnFile.updateUserData(RED.nodes.getNode(req.body.data.configNodeId), req.body.data, RED, req.body.data.configNodeId);
        }
        // use frontend user data (e.g. create new node with new EWIO2 configuration node (where no credentials,... are available))
        else if (req.body.data.user && req.body.data.pw) {
            userData = ewioConnFile.updateUserData(undefined, req.body.data, RED, req.body.data.configNodeId);
        }
        // deactivated EWIO2 configuration node
        else {
            pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "status.configNodeMissing", "configNodeId": req.body.data.configNodeId});
            RED.comms.publish("publish/ewio2/error/" + req.body.data.configNodeId, {code: ("status.configNodeMissing")});
            res.sendStatus(200);
        }
        log(node, 'userData: ' + JSON.stringify(userData, null, 4));
        if (userData) {
            if (typeof userData === "number") {
                log(node, 'sendStatus: ' + userData);
                res.sendStatus(userData);
            }
            else {
                try {
                    await ewioConnFile.getConfigData(userData, req.params.iotype, req.params.prevIoPort, req.params.counterId, req.params.nodeId, RED, req.body.tlsConfig);
                    res.sendStatus(200);
                }
                catch (error) {
                    log(node, 'get config backend error: ' + error)
                    res.sendStatus(404)
                }
            }
        }
    });

    /**
    * Backend functionality to close websocket connection and delete entry from ewio2Connections map. This is done when a EWIO2 configuration is saved or deleted.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/put/ewio2/closeDeleteWebsocket", RED.auth.needsPermission("ewio2.write"), function (req, res) {
        const node = RED.nodes.getNode(req.body.configNodeId);
        log(node, 'closeDeleteWebsocket backend reached');
        let userData;
        // decide between frontend and backend user data, or a combination
        if (RED.nodes.getNode(req.body.configNodeId)) {
            userData = ewioConnFile.updateUserData(RED.nodes.getNode(req.body.configNodeId), req.body, RED, req.body.configNodeId);
        }
        // use frontend user data (e.g. create new node with new EWIO2 configuration node (where no credentials,... are available))
        else if (req.body.user && req.body.pw) {
            userData = ewioConnFile.updateUserData(undefined, req.body, RED, req.body.configNodeId);
        }
        // deployed node and NOT deployed EWIO2 config node: create EWIO2 config node with bad credentials -> save -> edit EWIO2 config node -> delete --> show status for deployed node
        else {
            pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "status.configNodeMissing", "configNodeId": req.body.configNodeId});
            RED.comms.publish("publish/ewio2/error/" + req.body.configNodeId, {code: ("status.configNodeMissing")});
            res.sendStatus(200);
        }
        log(node, 'userData: ' + JSON.stringify(userData, null, 4))
        if (userData) {
            if (typeof userData === "number") {
                log(node, 'sendStatus: ' + userData)
                res.sendStatus(userData);
            }
            else {
                try {
                    log(node, 'close delete websocket');
                    ewioConnFile.closeDeleteWebsocket(undefined, userData, RED);
                    res.sendStatus(200);
                }
                catch (error) {
                    log(node, 'close delete websocket backend error: ' + error);
                    res.sendStatus(404)
                }
            }
        }
    });

    /**
    * Receives analog input configuration http post request from frontend and set configuration at EWIO2.
    * @memberof Ewio2ConfigNode
    */
    RED.httpAdmin.post("/put/ewio2/aiConfig/:configValue/:ioPort/:nodeId", RED.auth.needsPermission("ewio2.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.nodeId);

        log(node, 'put ai config backend reached');
        let userData;
        // decide between frontend and backend user data, or a combination
        if (RED.nodes.getNode(req.body.data.configNodeId)) {
            userData = ewioConnFile.updateUserData(RED.nodes.getNode(req.body.data.configNodeId), req.body.data, RED, req.body.data.configNodeId);
        }
        // use frontend user data (e.g. create new node with new EWIO2 configuration node (where no credentials,... are available))
        else if (req.body.data.user && req.body.data.pw) {
            userData = ewioConnFile.updateUserData(undefined, req.body.data, RED, req.body.data.configNodeId);
        }
        // deactivated EWIO2 configuration node
        else {
            pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "status.configNodeMissing", "configNodeId": req.body.data.configNodeId});
            RED.comms.publish("publish/ewio2/error/" + req.body.data.configNodeId, {code: ("status.configNodeMissing")});
            res.sendStatus(200);
        }
        log(node, 'userData: ' + JSON.stringify(userData, null, 4));
        if (userData) {
            if (typeof userData === "number") {
                log(node, 'sendStatus: ' + userData);
                res.sendStatus(userData);
            }
            else {
                try {
                    await ewioConnFile.setValue(userData, req.params.configValue, "ai", req.params.ioPort, req.params.nodeId, RED, "setConfig", req.body.tlsConfig);
                    res.sendStatus(200);
                }
                catch (error) {
                    log(node, 'put ai config backend error: ' + error);
                    res.sendStatus(404)
                }
            }
        }
    });
}
