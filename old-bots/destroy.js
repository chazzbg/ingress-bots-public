
var Ingress = require('ingress-api'),
    fs = require('fs'),
    celldata = JSON.parse(fs.readFileSync("./celldata.json")),
    config = fs.readFileSync("./config.txt").toString("utf8").split("\n"),
    auth = { 'sacsid': config[0].split("SACSID=")[1], 'xsrf': config[1].split("X-XsrfToken ")[1] },
    ingress = new Ingress({ api: { auth: auth } }),
    api = new ingress.getApi({ auth: auth }),
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

api.setProxy({ host: "127.0.0.1", port: 8888 });

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

function filter(data) {
    return function (item) {
        if (typeof item[2].resourceWithLevels !== "undefined") {
            if (item[2].resourceWithLevels.resourceType === "EMITTER_A") {
                return data[0] === "EMITTER_A" && data[1] === item[2].resourceWithLevels.level;
            } else if (item[2].resourceWithLevels.resourceType === "EMP_BURSTER") {
                return data[0] === "EMP_BURSTER" && data[1] === item[2].resourceWithLevels.level;
            } else if (item[2].resourceWithLevels.resourceType === "MEDIA") {
                return data[0] === "MEDIA" && data[1] === item[2].resourceWithLevels.level;
            }
        } else if (typeof item[2].modResource !== "undefined") {
            if (item[2].modResource.resourceType === "RES_SHIELD") {
                if (item[2].modResource.stats.MITIGATION === 6) {
                    return data[0] === "RES_SHIELD" && data[1] === item[2].modResource.stats.MITIGATION === 6;
                } else if (item[2].modResource.stats.MITIGATION === 8) {
                    return data[0] === "RES_SHIELD" && data[1] === item[2].modResource.stats.MITIGATION === 8;
                } else if (item[2].modResource.stats.MITIGATION === 10) {
                    return data[0] === "RES_SHIELD" && data[1] === item[2].modResource.stats.MITIGATION === 10;
                }
            }
        } else if (typeof item[2].resource !== "undefined") {
            if (item[2].resource.resourceType === "PORTAL_LINK_KEY") {
                return data[0] === "PORTAL_LINK_KEY";
            }
        }
        return false;
    }
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
        if (resonator !== null) {
            data.push({
                slot: resonator.slot,
                octant: octantMap[resonator.slot],
                location: calcPoint(location, bearings[resonator.slot], resonator.distanceToPortal / 1000)
            });
        }
    });
    return data;
}

var burster = [];
var portals = [];

function getObjectsInCells(cells, callback) {
    api.api('gameplay/getObjectsInCells', cells, function(err, data) {
        if (err) {
            console.log('error:', err, data);
            return;
        }
        callback(data);
    });
}

function getInventory(callback, cached) {
    if (cached) {
        callback(JSON.parse(fs.readFileSync("./inventory.json")));
        return;
    } else {
        api.api('playerUndecorated/getInventory', {}, function(err, data) {
            if (err) console.log(err);
            else {
                callback(data);
            }
        });
    }
}

function getXM(cells, callback) {
    console.log("looking for XM at:", cells.location);
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
        callback();
    });
}

var cells = celldata[4];

getObjectsInCells(cells, function (data) {
    console.log("got objects in cells");
    portals = data.gameBasket.gameEntities.filter(isPortal);

    api.player.AP = data.gameBasket.playerEntity[2].playerPersonal.ap;
    api.player.LEVEL = calcLvl(api.player.AP);
    api.player.XM = data.gameBasket.playerEntity[2].playerPersonal.energy;
    api.player.FACTION = data.gameBasket.playerEntity[2].controllingTeam.team;

    globalXM = data.gameBasket.energyGlobGuids;

    getInventory(function (data) {
        console.log("got inventory");
        burster = data.gameBasket.inventory.filter(filter(["EMP_BURSTER", process.argv[2]]));
        destroy(portals.shift(), portals);
    });
});


function destroy(portal, portals) {
    var empty = portal[2].resonatorArray.resonators.every(function (resonator) { return resonator === null; });
    if (!empty) {
        console.log("destroying portal");
        var resonators = mapResonators({ lat: portal[2].locationE6.latE6 / 1000000, lng: portal[2].locationE6.lngE6 / 1000000 }, portal[2].resonatorArray.resonators);
        destroyResonator(resonators[0], function () {
            setTimeout(function () {
                destroy(portal, portals);
            }, 2000);
        });
    } else {
        destroy(portals.shift(), portals);
    }

}

function destroyResonator(resonator, callback) {
    console.log("destroying resonator");
    var weapon = burster.shift();
    if (typeof weapon === "undefined") {
        console.log("no weapons left");
        return;
    }
    var location = geo.geo2hex_pair(resonator.location);

    var xm = getEnergyGuids(api.player.LEVEL, api.player.XM, globalXM);
    globalXM = globalXM.filter(function (guid) { if (xm.indexOf(guid) > 0) { return false; } return guid; });
    var cells = celldata[unusedEnery++];
    if (typeof cells === "undefined") unusedEnery = 0;
    if (globalXM.length === 0) {
        getXM(cells, function () {
            destroyResonator(resonator, callback);
        });
        return;
    }

    fireWeapon(weapon[0], location, xm, function (data) {
        data.result.damages.forEach(function (damage) {
            if (damage.targetSlot === resonator.slot) {
                console.log("damage:", damage.damageAmount)
                if (damage.targetDestroyed === true) {
                    console.log("target destroyed");
                    callback();
                }
            } else {
                setTimeout(function () {
                    destroyResonator(resonator, callback);
                }, 2000)
            }
        });
    });
}

function fireWeapon(guid, location, xm, callback) {
    api.api("gameplay/fireUntargetedRadialWeapon", { itemGuid: guid, playerLocation: location, energyGlobGuids: xm || [] }, function (err, data) {
        callback(data);
    });
}
