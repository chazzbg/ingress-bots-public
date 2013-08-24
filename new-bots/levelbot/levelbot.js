
var fs            = require('fs'),
    util          = require('util'),
    EventEmitter  = require('events').EventEmitter,
    exec          = require('child_process').exec,
    colors        = require('colors'),
    IngressClient = require('ingress-client'),
    cells         = JSON.parse(fs.readFileSync('./cellsAsHex.json').toString());

var email         = process.argv[2],
    pass          = process.argv[3],
    speedMul      = process.argv[4],
    portalGuid    = process.argv[5],
    ingressClient = new IngressClient(email, pass);

var bot = null;

var levels = [0, 1E4, 3E4, 7E4, 15E4, 3E5, 6E5, 12E5];
var xm_level = [3E3, 4E3, 5E3, 6E3, 7E3, 8E3, 9E3, 1E4];

function get_level(ap) {
    var level = 1;
    for (var i = 0; i < levels.length; i += 1) {
        var ap_level = levels[i];
        if (ap >= ap_level) {
            level = i + 1;
        }
    }
    return level;
}

function xm_per_level(ap) {
    var level = get_level(ap);
    var xm = xm_level[level - 1];
    return xm;
}



Array.prototype.remove = function(from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

Array.prototype.randomize = function () {
    for (var i = this.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = this[i];
        this[i] = this[j];
        this[j] = tmp;
    }
    return this;
};



function is(type) { return function (entity) { return entity.is(type); }; }

function isEnemyPortal(entity) {
    return entity.payload.controllingTeam.team === 'RESISTANCE';
}

function locE6ToGeo(locationE6) {
    return [locationE6.latE6 / 1E6, locationE6.lngE6 / 1E6];
}

function mapToOriginEntity(entity) {
    return [entity.guid, entity.timestamp, entity.payload];
}

function printAgent(nickname, entity) {
    return ('Agent: ' + nickname + '. Faction: ' + entity.team.team +
            '. AP: ' + entity.ap + '. Energy: ' + entity.energy).green.bold;
}

function toHex(geo) {
    var hex = geo.toString(16),
        len = 8;

    if (hex.indexOf("-") > -1) {
        hex = (parseInt("ffffffff", 16) - parseInt(hex.substr(1), 16)).toString(16);
    }
    while (hex.length < len) {
        hex = "0" + hex;
    }

    return hex;
}

function getClosestPortal(portal, portals) {
    var loc = locE6ToGeo(portal.payload.locationE6);
    var closest = null;
    for (var i = 0; i < portals.length; i += 1) {
        var loc1 = locE6ToGeo(portals[i].payload.locationE6);
        var dst = distance(loc[0], loc[1], loc1[0], loc1[1]);
        if (closest === null || dst < closest.distance) {
            closest = { distance: dst, portal: portals[i] };
        }
    }
    return closest;
}

function distance(lat1, lon1, lat2, lon2) {
    var R = 6371.01;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180 ) * Math.cos(lat2 * Math.PI / 180 ) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;
    return d * 1E3; // meters
}



function LevelBot(client) {
    EventEmitter.call(this);

    this.client = client;
    this.items = [];
    this.portals = [];
    this.hacked_portals = {};
    this.current_portal = 0;
    this.player = {};
    this.cached_xm = [];
    this.xm = [];
    this.lastHacks = [];
    this.lastHack = [];
    this.tid = null; // timer id
    this.speedMultiplier = speedMul; // will be multiplied with distance (in m).
                    // the result will be used as timeout between hacks (in ms).

    this.client.on('error', function (error) {
        console.log(error);
        if (error === 'PLAYER_DEPLETED' || error === 'NEED_MORE_ENERGY') {
            this.useXM(function (err, data) {
                console.log(err, data);
                this.hackPortal(this.portals[this.current_portal], this.portals);
            }.bind(this));
        }
        if (error.indexOf('TOO_') > -1) {
            var timeout = 0;
            var times = 0;
            if (error.indexOf('TOO_SOON_') > -1) {
                timeout = parseInt(error.substr(9), 10);
                times = 1;
            }
            if (error.indexOf('TOO_SOON_BIG') > -1) {
                timeout = 300;
                times = 1;
            }
            if (error.indexOf('TOO_OFTEN') > -1) {
                times = 4;
                timeout = 7200;
            }
            var portal = this.portals[this.current_portal].portal;
            var hackedportal = this.hacked_portals[portal.guid] || { time: 0, times: 0 };
            hackedportal.timeout = timeout;
            hackedportal.times = times;
            this.hacked_portals[portal.guid] = hackedportal;
            this.hackPortal(this.portals[++this.current_portal], this.portals);
        }
    }.bind(this));

    this.client.on('playerEntity', function (entity) {
        this.client.getPlayer(function (player) {
            if (player.ap > this.player.ap) {
                console.log(printAgent(this.nickname, player));
            }
            this.player = player;
        }.bind(this));
    }.bind(this));

    this.client.on('inventory', function (data) {
        this.lastHack = data;
    }.bind(this));

    this.on('recycle', function (locationE6) {
        this.recycleItems(locationE6);
    }.bind(this));

    setInterval(function () {
        console.log('reinitializing...'); // to rescan the area
        this.initialize(true);
    }.bind(this), 20 * 60 * 1000);

    setInterval(function () {
        this.getInventory();
    }.bind(this), 5 * 60 * 1000);
}
util.inherits(LevelBot, EventEmitter);

LevelBot.prototype.initialize = function (guid, reinitialize) {
    console.log('initialize called');
    clearTimeout(this.tid);
    reinitialize = typeof guid === 'boolean' ? guid : reinitialize;
    var portal = reinitialize ? this.portals[this.current_portal].portal : undefined;

    this.portals        = [];
    this.current_portal = 0;
    this.player         = {};
    this.cached_xm      = [];
    this.xm             = [];
    this.tid            = null;


    this.getPlayer(function (player) {
        console.log(printAgent(this.nickname, player));

        this.getPortals(function (portals) {
            console.log('get portals');

            // this.portals = portals.filter(isEnemyPortal);
            this.portals = portals;
            if (typeof guid === 'string') {
                portal = this.portals.filter(function (portal) { return portal.guid === guid; })[0];
                console.log('initializing with portal...');
            }
            this.portals = this.sortPortals(this.portals, portal);
            console.log('hacking', this.portals.length, 'portals');
            this.hackPortals(this.portals);

        }.bind(this));
    }.bind(this));

    this.getInventory();
};

LevelBot.prototype.getPlayer = function (callback) {
    this.client.getPlayer(function (player) {
        this.player = player.entity;
        if (!this.nickname) this.nickname = player.entity.nickname;
        if (typeof callback === 'function') callback(this.player);
    }.bind(this));
};

LevelBot.prototype.getPortals = function (callback) {
    this.client.getMap(function (map) {
        map.getObjects(cells.cellsAsHex, cells.dates, cells.location, function (err, objects) {
            if (err) {
                console.log('error getting objects:', err);
                process.exit(1);
            }
            this.portals = objects.filter(is('PORTAL'));
            this.cached_xm = objects.filter(is('ENERGY_GLOB'));

            fs.writeFileSync('./cache.json', JSON.stringify(objects, null, 4));
            if (typeof callback === 'function') callback(this.portals);
        }.bind(this));
    }.bind(this));
};

LevelBot.prototype.getStubPortals = function (callback) {
    this.client.getMap(function (map) {
        var objects = JSON.parse(fs.readFileSync('./cache.json').toString());
        objects = map.__processEntities(objects.map(mapToOriginEntity));
        this.portals = objects.filter(is('PORTAL'));
        this.cached_xm = objects.filter(is('ENERGY_GLOB'));
        if (typeof callback === 'function') callback(this.portals);
    }.bind(this));
};

LevelBot.prototype.getInventory = function () {
    console.log('get inventory');
    this.client.getInventory(function (inventory) {
        inventory.getItems(function (err, items) {
            console.log('inventory size', items.length);
            this.items = items;
        }.bind(this), true);
    }.bind(this));
};

LevelBot.prototype.getXM = function (amount) {
    var tmpAmount = 0,
        xm = 0;
    this.xm = [];
    while (tmpAmount < amount) {
        xm = this.cached_xm.pop();
        tmpAmount += xm.energy;
        this.xm.push(xm.guid);
    }
    return this.xm;
};

LevelBot.prototype.useXM = function (callback) {
    var current_xm = this.player.energy;
    var max_xm = xm_per_level(this.player.ap);
    var needed_xm = max_xm - current_xm;
    var xm = this.getXM(needed_xm);
    var params = {
        cellsAsHex: ["47b8cbce10000000", "47b8cbcf10000000", "47b8cbcc10000000",
                     "47b8cbced0000000", "47b8cbcfd0000000", "47b8cbcdd0000000",
                     "47b8cbce90000000", "47b8cbcf90000000", "47b8cbcd90000000",
                     "47b8cbd1d0000000", "47b8cbce50000000", "47b8cbcf50000000",
                     "47b8cbcc50000000", "47b8cbd210000000", "47b8cbce30000000",
                     "47b8cbcf30000000", "47b8cbcc30000000", "47b8cbcef0000000",
                     "47b8cbcff0000000", "47b8cbcdf0000000", "47b8cbd1f0000000",
                     "47b8cbceb0000000", "47b8cbcfb0000000", "47b8cbcdb0000000",
                     "47b8cbd030000000", "47b8cbce70000000", "47b8cbcf70000000",
                     "47b8cbcc70000000"],
        dates: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0],
        playerLocation: "030d8ebc,0067eb1e",
        energyGlobGuids: xm
    };
    this.client.api('gameplay/getObjectsInCells', params, callback);
};



LevelBot.prototype.sortPortals = function (portals, portal) {
    portals = portals.randomize();
    var sorted = [];
    var prev = { portal: portal || portals[0], distance: 0 };
    while (portals.length) {
        portals.remove(portals.indexOf(prev.portal));
        sorted.push(prev);
        prev = getClosestPortal(prev.portal, portals);
    }
    var filename = './' + this.player.guid + '-portals.json';
    fs.writeFileSync(filename, JSON.stringify(sorted, null, 4));
    return sorted;
};

LevelBot.prototype.hackPortals = function (portals) {
    console.log('hack portals');
    this.hackPortal(portals[this.current_portal], portals);
};

LevelBot.prototype.hackPortal = function (portal, portals) {
    if (typeof portal === 'undefined') {
        return this.initialize(true);
    }
    var guid = portal.portal.guid;
    var hackedportal = this.hacked_portals[guid] || {
            time: 0, // last hack timestamp
            firstTime: Date.now(), //first hack timestamp
            times: 0 // total hacks
        };
    console.log('hacking portal', '#' + this.current_portal, hackedportal, '\n' + guid);

    if (hackedportal.times >= 4 &&
            Date.now() - hackedportal.firstTime < 4 * 60 * 60 * 1000) {
        return this.hackPortal(portals[++this.current_portal], portals);
    }
    if (hackedportal.time + 5 * 60 * 1000 <= Date.now()) {
        console.log('portal is cold enough');
        this.emit('recycle', portal.portal.payload.locationE6);
        portal.portal.hack(this.client, function (err, data) {
            if (err) {
                console.log('error!', err);
            } else {
                hackedportal.times += 1;
                hackedportal.time = Date.now();

                this.hacked_portals[guid] = hackedportal;

                this.lastHacks.push(data.addedGuids.length);

                console.log('hacked portal', hackedportal.times, 'times and got',
                    data.addedGuids.length, 'items');

                this.verifyHack(portal.portal, data);
            }

            var next = portals[this.current_portal + 1];
            if (!next) return this.initialize(true);
            var timeout = next.distance * this.speedMultiplier;

            console.log('next portal is', next.distance.toFixed(2),
                'meters away, waiting for', (timeout / 1000).toFixed(2), 'seconds');

            if (!this.checkLastHacks(8)) { // prevent blocks.
                //if the last n hacks all failed, wait for some time.
                console.log('we are blocked! waiting for 20 minutes...'.red.bold);
                return this.tid = setTimeout(function () {
                    this.hackPortal(portals[this.current_portal], portals);
                }.bind(this), 20 * 60 * 1000);
            }

            this.tid = setTimeout(function () {
                this.hackPortal(portals[++this.current_portal], portals);
            }.bind(this), timeout);
        }.bind(this));
    } else {
        console.log('portal is too hot! retrying in', ((Date.now() - hackedportal.time) / 1000),
            'seconds.');
        this.tid = setTimeout(function () {
            this.hackPortal(portals[this.current_portal], portals);
        }.bind(this), hackedportal.time + 5 * 60 * 1000 - Date.now());
    }
};

LevelBot.prototype.verifyHack = function (portal, result) {
    if (result.addedGuids.length === 0 || result.addedGuids.indexOf(this.lastHack[0][0]) > -1) {
        this.emit('hack', {
            portal: portal,
            hack: this.lastHack
        });
    }
};

LevelBot.prototype.checkLastHacks = function (n) {
    if (this.lastHacks.length < n) return true;
    var last = this.lastHacks.slice(Math.max(this.lastHacks.length - n, 1));
    return !last.every(function (hack) { return hack === 0; });
};

LevelBot.prototype.recycleItems = function (position) {
    console.log('inventory size:', this.items.length, 'recycling...');
    var recycle = {
            EMP_BURSTER: [1, 2, 3, 4, 5, 6, 7],
            EMITTER_A: [1, 2, 3, 4, 5, 6],
            RES_SHIELD: ['COMMON'],
            MEDIA: [1, 2, 3, 4, 5, 6, 7, 8]
        },
        client = this.client;

    this.items = this.items.filter(function (item) {
        for (var type in recycle) {
            if (item.is(type)) {
                if (recycle[type].indexOf(item.level) > -1 ||
                        recycle[type].indexOf(item.rarity) > -1) {
                    item.recycle(client, toHex(position.latE6) + ',' + toHex(position.lngE6), function () {});
                    return false;
                }
            }
        }
        return true;
    });
    console.log('inventory size:', this.items.length);
};





function PortalStats(levelbot) {
    this.bot  = levelbot;
    var filename = './stats/' + this.bot.player.guid + '-portals.txt';
    this.stream = fs.createWriteStream(filename, { flags: 'a' });

    this.bot.on('hack', this.hack.bind(this));
}

PortalStats.prototype.hack = function (data) {
    var player = this.bot.player;
    var hack   = this.getHackData(data.hack);
    var now    = Date.now();

    this.getPortalInfo(data.portal, function (portal) {
        if (portal) {
            portal = this.formatPortal(portal);
            var write = [now, player.team.team, player.ap, portal.guid, portal.team,
                         portal.level, portal.resonators, portal.mods, hack];

            this.stream.write(write.join(';') + '\n');
        }
    }.bind(this));
};

PortalStats.prototype.getPortalInfo = function (portal, callback) {
    var args = locE6ToGeo(portal.payload.locationE6);
    args.push(50);
    var celldata = exec('./cellsAsHex.sh ' + args.join(' '), function (err, stdout, stderr) {
        if (err !== null) {
            console.log('error!', err);
            process.exit(0);
        }

        var cells = JSON.parse(stdout);
        var dates = cells.map(function () { return 0; });
        var loc = {
            lat: toHex(portal.payload.locationE6.latE6),
            lng: toHex(portal.payload.locationE6.lngE6)
        }

        this.bot.client.getMap(function (map) {
            map.getObjects(cells, dates, loc, function (err, objects) {
                if (err) {
                    console.log('error getting objects:', err);
                    process.exit(1);
                }

                if (typeof callback === 'function') {
                    callback(objects.filter(function (entity) {
                        return entity.guid === portal.guid;
                    })[0]);
                }
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

PortalStats.prototype.getHackData = function (hack) {
    return hack.map(this.formatItem).join(',');
};

PortalStats.prototype.formatPortal = function (portal) {
    var resos = portal.payload.resonatorArray.resonators.map(function (reso) {
        return reso ? reso.level : 0;
    });
    return {
        guid: portal.guid,
        team: portal.payload.controllingTeam.team,
        level: resos.reduce(function (p, c) { return p + c; }, 0) / resos.length,
        resonators: resos.join(','),
        mods: portal.payload.portalV2.linkedModArray.map(function (mod) {
            return mod ? mod.type + ':' + mod.rarity : mod;
        })
    };
};

PortalStats.prototype.formatItem = function (item) {
    var d = item[2],
        type, data;
    if (typeof d.resourceWithLevels !== 'undefined') {
        type = d.resourceWithLevels.resourceType;
        data = d.resourceWithLevels.level;
    } else if (typeof d.resource !== 'undefined') {
        type = d.resource.resourceType;
        data = d.flipCard ? d.flipCard.flipCardType: 'null';
    } else if (typeof d.modResource !== 'undefined') {
        type = d.modResource.resourceType;
        data = d.modResource.rarity;
    }
    return type + ':' + data;
};





function init() {
    ingressClient.login(function (err, handshake, client) {
        if (err) {
            console.log('cannot login', err);
            return init(); // retry
        }

        console.log('logged in');

        bot = new LevelBot(client);
        bot.initialize(portalGuid);

        var stats = new PortalStats(bot);
    });
}

init();
