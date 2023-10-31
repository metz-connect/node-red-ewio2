/**
 * @file Discovery library used by Node-RED runtime. Send discovery responses, to find EWIO2 and handle responses.
 * @author Metz Connect
 */

/**
 * Discovery namespace.
 * @namespace Discovery
 */

const MD5 = require("crypto-js/md5");

const RESPONSE = Buffer.from("EWIO2DA");
const RESPONSE2 = Buffer.from("EWIO2DB");
const LOCALHOST_ADDR = "127.0.0.1";
const BROADCAST_TIMEOUT = 3000;

/**
 * Gets the IPv4 addresses of the network interfaces, also of internal interfaces (e.g. 127.0.0.1).
 * @memberof Discovery
 * @param {Object[]} ewioNets - Information of all network interfaces.
 * @return {string[]} List of IPv4 addresses of network interfaces.
 */
function getNetworkInterfaceAddresses(ewioNets) {
    const netAddr = [];
    // put addresses of network interfaces into an array (first internal --> external)
    for (const name of Object.keys(ewioNets)) {
        for (const net of ewioNets[name]) {
            // Skip over non-IPv4 addresses
            // In Node version <= 17 net.family is "IPv4", from Node version 18 net.family is a number 4 or 6
            const familyV4Value = typeof net.family === "string" ? "IPv4" : 4
            if (net.family === familyV4Value) {
                // put addresses to the end of the array
                netAddr.push(net.address);
            }
        }
    }
    return netAddr;
}

/**
 * Handles the received discovery message.
 * Places reveived message into a list of received object.
 * Response message must start with "EWIO2DA" or "EWIO2DB" and the received and the calculated MD5 hash must fit.
 * Message must contain all fields until hostname (location and Node-RED flags are optional).
 * Duplicate entries are avoided.
 * If a duplicate is available, with localhost address, the existing object in the list is replaced with the localhost object.
 * If a duplicate is available, with deactivated Node-RED flags, the existing object in the list is replaced with the object with activated Node-RED flags.
 * @memberof Discovery
 * @param {Object} message - Discovery response for one EWIO2 device.
 * @param {Object} remote - Additional information of the discovered EWIO2 (e.g. address and port)
 * @param {Object[]} ewioData - The information of EWIO2 discovery.
 * @return {Object[]} Updated information of EWIO2 discovery.
 */
function handleReceivedMessage(message, remote, ewioData) {
    let msgString = String(message);
    if (msgString.includes("®")) {
        let splitted = msgString.split("®");
        if (splitted.length >= 2 && (splitted[0] == RESPONSE || splitted[0] == RESPONSE2)) {
            const md5Recv = splitted[1];
            const msgHeader = splitted[0] + "®" + splitted[1] + "®";
            let msgBody = msgString.replace(msgHeader, "");
            // received message may contain ASCII 0 (0x00) as last character --> remove
            msgBody = msgBody.replace(/\0/g, "");
            const md5Calc = MD5(msgBody);
            // compare received and calculated MD5 hash
            if (md5Recv == md5Calc) {
                // all resonse fields until hostname must be available, location and Node-RED flags are optional
                if (splitted.length >= 7) {
                    let location = "";
                    // location available, location may contain ASCII 0 (0x00) as last character --> remove
                    if (splitted.length >= 8) {
                        location = splitted[7].replace(/\0/g, "");
                    }
                    let nodeRedInfo = "";
                    // Node-RED flags available, flags may contain ASCII 0 (0x00) as last character --> remove
                    if (splitted.length >= 9) {
                        nodeRedInfo = splitted[8].replace(/\0/g, "");
                    }
                    const nodeRedAvailable = (Number(nodeRedInfo) & 1);
                    const nodeRedRunning = ((Number(nodeRedInfo) & 2) >> 1);
                    let available = false;
                    for (ewio of ewioData) {
                        // check for duplicates (hostname and location already available in array)
                        if (ewio.hostname == splitted[6] && ewio.location == location) {
                            // replace EWIO2 in array with localhost address, if EWIO2 was already discovered with another IP address over another network interface (e.g. eth0)
                            // or replace EWIO2 due to acitvated Node-RED flags (Node-RED available or running)
                            if ((ewio.address != LOCALHOST_ADDR && remote.address == LOCALHOST_ADDR) ||
                            (!ewio.nrAvailable && nodeRedAvailable) || (!ewio.nrRunning && nodeRedRunning) ) {
                                const idx = ewioData.map(e => e.hostname).indexOf(splitted[6]);
                                const splicedElements = ewioData.splice(idx, 1);
                            }
                            else {
                                available = true;
                            }
                            break;
                        }
                    }
                    if (!available) {
                        ewioData.push({address: remote.address, location: location, hostname: splitted[6], nrAvailable: nodeRedAvailable, nrRunning: nodeRedRunning, hwModell: splitted[2], swVersion: splitted[3], serial: splitted[4], mac: splitted[5]});
                    }
                }
                // incomplete (too less "®" separators) in response string -> show received msg as hostname
                else {
                    ewioData.push({address: remote.address, location: "", hostname: "INCOMPLETE: " + msgBody, nrAvailable: "", nrRunning: "", hwModell: "", swVersion: "", serial: "", mac: ""});
                }
            }
        }
    }
    return ewioData;
}

/**
 * Sorts all discovered EWIO2 according hostname (in ascending order).
 * If EWIO2 on localhost ist found, this one is placed at first position of the array.
 * @memberof Discovery
 * @param {Object[]} ewioData - The information of EWIO2 discovery.
 * @return {Object} The information of EWIO2 discovery in correct order.
 */
function sortResults(ewioData) {
    // sort array according hostname in ascending order
    ewioData = ewioData.sort( function(a, b) {
        if (a.hostname > b.hostname) {
            return 1;
        }
        if (b.hostname > a.hostname) {
            return -1;
        }
        return 0;
    });
    // sort array according Node-RED informaton flags (Node-RED available and running devices at top)
    ewioData = ewioData.sort( function(a, b) {
        if ((a.nrAvailable & a.nrRunning) > (b.nrAvailable & b.nrRunning)) {
            return -1;
        }
        if ((b.nrAvailable & b.nrRunning) > (a.nrAvailable & a.nrRunning)) {
            return 1;
        }
        return 0;
    });
    // find localhost (if available) in array, cut localhost and past at first position of array
    const indexLocalhost = ewioData.findIndex(function(ewio) {
        return ewio.address == LOCALHOST_ADDR;
    });
    // shift localhost to first position of array, only if localhost was found inbetween array elements
    if (indexLocalhost > 0) {
        ewioData.unshift(ewioData.splice(indexLocalhost, 1)[0]);
    }
    return ewioData;
}

/**
 * Wait for timeout, to have time that EWIO2 can respond to discovery.
 * @memberof Discovery
 * @return {Promise} resolve if timout is reached.
 */
function waitForTimeout() {
    return new Promise((resolve) =>  setTimeout(resolve, BROADCAST_TIMEOUT));
}

module.exports = { getNetworkInterfaceAddresses, handleReceivedMessage, sortResults, waitForTimeout };
