
var Ingress = require('ingress-api'),
    fs = require('fs'),
    celldata = JSON.parse(fs.readFileSync("./celldata.json")),
    config = fs.readFileSync("./config.txt").toString("utf8").split("\n"),
    auth = { 'sacsid': config[0].split("SACSID=")[1], 'xsrf': config[1].split("X-XsrfToken ")[1] },
    ingress = new Ingress({ api: {auth: auth}}),
    api = new ingress.getApi(),
    geo = new ingress.getGeo(),
    AP_LEVELS = [0, 10000, 30000, 70000, 150000, 300000, 600000, 1200000],
    globalXM = [],
    ap_gained = 0,
    EARTH_RADIUS = 6371.01,
    EPSILON = 0.000001,
    unusedEnery = 0;


api.player = {
    AP: 0,
    LEVEL: 1,
    XM: 0,
    FACTION: ""
};

// api.setProxy({ host: "127.0.0.1", port: 8888 });


function calcLvl(ap) {
    var L = 0;
    AP_LEVELS.forEach(function (threshold, level) {
        if (ap > threshold) {
            L = level + 1;
        }
    });
    return L;
}

function calcXMAmount(guid) { return parseInt(guid.split(".6")[0].substr(-2), 16); }
function isPortal(a) { var b = a[0].substr(-3); return b === ".11" || b === ".12" ? b : false; }

function portalTeam(team) {
    return function (prev, curr) {
        return prev += (curr[2].controllingTeam.team === team ? 1 : 0);
    };
}

function getEnergyGuids(level, energy, xmguids) {
    var maxXM = (level + 2) * 1000;
    var xmNeeded = maxXM - energy;
    return xmguids.filter(function (guid) {
        if (xmNeeded > 0) {
            xmNeeded -= calcXMAmount(guid);
            return guid;
        }
        return false;
    });
}

function calcDistance(portal, portal2) {
    if (typeof portal2 !== "undefined" && typeof portal2[2] !== "undefined") {
        var loc1 = [portal[2].locationE6.latE6 / 1000000, portal[2].locationE6.lngE6 / 1000000];
        var loc2 = [portal2[2].locationE6.latE6 / 1000000, portal2[2].locationE6.lngE6 / 1000000];
        var dLat = deg2rad(loc2[0] - loc1[0]);
        var dLon = deg2rad(loc2[1] - loc1[1]);

        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(loc1[0]) * Math.cos(loc1[1]);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return EARTH_RADIUS * c;
    } else {
        return 0;
    }
}

function calcTimeout(distance) {
    var speed = 50; // kmh
    return distance / speed * 60 * 60 * 1000;
}

function rad2deg(angle) {
    return angle * 180 / Math.PI;
}
function deg2rad(angle) {
    return angle * Math.PI / 180;
}

function calcPoint(location, bearing, distance) {
    var rlat1 = deg2rad(location.lat);
    var rlng1 = deg2rad(location.lng);
    var rbearing = deg2rad(bearing);
    var rdistance = distance / EARTH_RADIUS;

    var rlat = Math.asin(Math.sin(rlat1) * Math.cos(rdistance) + Math.cos(rlat1) * Math.sin(rdistance) * Math.cos(bearing));
    var rlng = 0;

    if (Math.cos(rlat) === 0 || Math.abs(Math.cos(rlat)) < EPSILON) {
        rlng = rlng1;
    } else {
        rlng = ((rlng1 - Math.asin(Math.sin(rbearing) * Math.sin(rdistance) / Math.cos(rlat)) + Math.PI) % (2 * Math.PI)) - Math.PI;
    }

    return [
        Number(rad2deg(rlat).toFixed(6)),
        Number(rad2deg(rlng).toFixed(6))
    ];
}

function mapResonators(location, resonators) {
    var octantMap = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
    var bearings = [deg2rad(270), deg2rad(315), deg2rad(0), deg2rad(45), deg2rad(90), deg2rad(135), deg2rad(180), deg2rad(225)];
    var data = [];
    resonators.forEach(function (resonator) {
        var octant = octantMap[resonator.slot];
        data.push({
            octant: octant,
            location: calcPoint(location, bearings[resonator.slot], resonator.distanceToPortal / 1000)
        });
    });
    return data;
}

function hackPortal(portal, portals, energy) {
    if (typeof portal !== "undefined" && typeof portal[0] !== "undefined") {
        var geohex = geo.geo2hex_pair([portal[2].locationE6.latE6 / 1000000, portal[2].locationE6.lngE6 / 1000000]);
        var params = { itemGuid: portal[0], playerLocation: geohex, energyGlobGuids: energy };
        var xm = [];
        var distance = calcDistance(portal, portals[0]);
        if (Number.isNaN(distance)) distance = 0.05;
        var timeout = calcTimeout(distance);
        for (var i = 0; i < 400; i += 1) {
            api.api('gameplay/collectItemsFromPortal', params, function () {});
        }
        api.api('gameplay/collectItemsFromPortal', params, function (err, data) {
            if (err) {
                console.log("hack error:", err);
            } else {

                console.log("hacking:", portal[2].portalV2.descriptiveText.TITLE);

                if (typeof data.gameBasket.apGains !== "undefined" && typeof data.gameBasket.apGains[0] !== "undefined") {
                    ap_gained += Number(data.gameBasket.apGains[0].apGainAmount);
                    console.log("gained:", data.gameBasket.apGains[0].apGainAmount, "AP for hacking an enemy portal.");
                }

                if (data.error) {
                    console.log("Error:", data.error);
                    if (data.error === "PLAYER_DEPLETED" || data.error === "NEED_MORE_ENERGY") {
                        xm = getEnergyGuids(api.player.LEVEL, api.player.XM, globalXM);
                        globalXM = globalXM.filter(function (guid) { if (xm.indexOf(guid) > 0) { return false; } return guid; });
                        if (globalXM.length === 0) {
                            getXM();
                        }
                        var cells = celldata[unusedEnery++];
                        if (typeof cells === "undefined") unusedEnery = 0;
                        getXM(cells, function () {
                            hackPortal(portal, portals, xm);
                        });
                        return;
                    } else if (data.error.indexOf("TOO_SOON") > 0 || data.error.indexOf("TOO_OFTEN") > 0) {
                        timeout = 0;
                    }
                }

                var items = typeof data.result !== "undefined" ? data.result.addedGuids.length : 0;
                console.log("got", items, "items");

                if (data.gameBasket.gameEntities.length === 0) {
                    console.log("got empty response - maybe moving too fast?");
                }

            }

            console.log("next portal is", distance.toFixed(2), "km away. waiting", (timeout / 1000).toFixed(2), "seconds to arrive.");

            console.log("-----");

            setTimeout(function () {
                hackPortal(portals.shift(), portals, xm);
            }, timeout);
        });
    } else {
        console.log(ap_gained);
    }
}

function getObjects(cells, callback) {
    delete cells.location;
    api.api('gameplay/getObjectsInCells', cells, function(err, data) {
        if (err) {
            console.log('error:', err, data);
            return;
        }

        api.player.AP = data.gameBasket.playerEntity[2].playerPersonal.ap;
        api.player.LEVEL = calcLvl(api.player.AP);
        api.player.XM = data.gameBasket.playerEntity[2].playerPersonal.energy;
        api.player.FACTION = data.gameBasket.playerEntity[2].controllingTeam.team;

        globalXM = data.gameBasket.energyGlobGuids;

        callback(err, data);
    });
}

function getXM(cells, callback) {
    console.log("looking for XM at:", cells.location);
    delete cells.location;
    api.api('gameplay/getObjectsInCells', cells, function(err, data) {
        if (err) {
            console.log('error:', err, data);
            return;
        }
        globalXM = data.gameBasket.energyGlobGuids;
        callback();
    });
}

var index = process.argv[2];


getObjects(celldata[index], function(err, data) {
    var portals = data.gameBasket.gameEntities.filter(isPortal);

    var enlightened = portals.reduce(portalTeam("ALIENS"), 0);
    var resistance = portals.reduce(portalTeam("RESISTANCE"), 0);

    console.log("PLAYER:", api.player);
    console.log("hacking", celldata[index].location, enlightened, "enlightened portals,", resistance, "resistance portals.");

    hackPortal(portals.shift(), portals, []);
});
