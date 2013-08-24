var Ingress = require('ingress-api'),
    fs = require('fs'),
    celldata = JSON.parse(fs.readFileSync("./cell_egypt.json")),
    config = fs.readFileSync(process.argv[2]).toString("utf8").split("\n"),
    auth = { 'sacsid': config[0].split("SACSID=")[1], 'xsrf': config[1].split("X-XsrfToken ")[1] },
    hackedPortalsFile = process.argv[3],
    hackedPortals = JSON.parse(fs.readFileSync(hackedPortalsFile)),
    ingress = new Ingress({ api: { auth: auth }}),
    api = ingress.getApi(),
    geo = ingress.getGeo(),
    AP_LEVELS = [0, 10000, 30000, 70000, 150000, 300000, 600000, 1200000],
    globalXM = [],
    ap_gained = 0,
    EARTH_RADIUS = 6371.01,
    EPSILON = 0.000001,
    unusedEnery = 0,
    currentPortal = null,
    currentCell = null,
    portalsInCellRange = [],
    inventory = null,
    bursters = null,
    resonators = null,
    fired = 0,
    hacks = 0,
    maxHacks = 20,
    amount = 0,
    portalNum = 3,
    secondsBetweenActions = 10;

api.player = {
    AP: 0,
    LEVEL: 1,
    XM: 0,
    FACTION: ""
};

// api.setProxy({ host: "127.0.0.1", port: 8888 });

function setFaction(cellData) {
  if(typeof(cellData.gameBasket.playerEntity[2].controllingTeam) != 'undefined') {
    api.player.FACTION = cellData.gameBasket.playerEntity[2].controllingTeam.team;
  }
}

function getLevelFromAP(ap) {
  for(var i = 0; i < AP_LEVELS.length; i++) {
    if(ap > AP_LEVELS[i]) {
      api.player.LEVEL = i + 1;
    }
  }
}

function calcXMAmount(guid) { return parseInt(guid.split(".6")[0].substr(-2), 16); }
function isPortal(a) { var b = a[0].substr(-3); return b === ".11" || b === ".12" ? b : false; }

function getEnergyGuids(energy, xmguids) {
  var level = api.player.LEVEL;
  var maxXM = (level + 2) * 1000;
  var xmNeeded = maxXM - energy;
  return xmguids.filter(function (guid) {
    if(xmNeeded > 0) {
      xmNeeded -= calcXMAmount(guid);
      return guid;
    }
    return false;
  });
}

function isHackable(guid) {
  if(guid in hackedPortals) {
    return false;
  }
  return true;
}

function addHackedPortal(guid) {
  hackedPortals[guid] = new Date().getTime();
  fs.writeFile(hackedPortalsFile, JSON.stringify(hackedPortals), function(err) {
    if(err) {
      console.log(err);
    } else {
      console.log("The file was saved!");
    }
  }); 
}

function getObjectsInCells(cells, callback) {
  api.api('gameplay/getObjectsInCells', cells, function(err, data) {
    if (err) {
      console.log('error:', err, data);
      return;
    }
    getLevelFromAP(data.gameBasket.playerEntity[2].playerPersonal.ap);
    setFaction(data);
    console.log("Your Level: ", api.player.LEVEL);
    console.log("Your Faction: ", api.player.FACTION);
    console.log("Your Energy: ", data.gameBasket.playerEntity[2].playerPersonal.energy);
    cells.energyGlobGuids = getEnergyGuids(data.gameBasket.playerEntity[2].playerPersonal.energy, data.gameBasket.energyGlobGuids);
    if(cells.energyGlobGuids.length > 0 && data.gameBasket.energyGlobGuids.length > 0 && data.gameBasket.deletedEntityGuids.length == 0) {
      getObjectsInCells(cells, callback);
    } else {
      callback(data.gameBasket.gameEntities.filter(isPortal));
    }
  });
}

function hack() {
  hacks = 0;
  if(isHackable(currentPortal[0])) {
    var geohex = geo.geo2hex_pair([currentPortal[2].locationE6.latE6 / 1000000, currentPortal[2].locationE6.lngE6 / 1000000]);
    addHackedPortal(currentPortal[0]);
    for(var i = 0; i < maxHacks; i++) {
      api.api("gameplay/collectItemsFromPortal", { itemGuid: currentPortal[0], playerLocation: geohex }, function (err, data) {
        hacks++;
        if(hacks >= maxHacks) {
          refreshInventory();
          console.log('Hacked successfully');
          handleNextPortal();
        }
      });
    }
  } else {
    console.log("Hacked already, next portal!");
    handleNextPortal();
  }
}
/*
function dropNeedlessStuff() {
  var mediaStuff = inventory.filter(filter(['MEDIA']));
  //var dropItems = mediaStuff.filter(function(item) { return item; });
	dropItem(mediaStuff);
  var keyStuff = inventory.filter(filter(['PORTAL_LINK_KEY']));
  // var dropItems = keyStuff.filter(function(item) { return item; });
	dropItem(keyStuff);
}

function dropItem(dropItems) {
  if(dropItems.length == 0) {
    console.log("Dropped needless stuff");
  } else {
    for(var i = 0; i < dropItems.length; i++) {
      if(typeof(dropItems[i][0]) != 'undefined') {
        var params = {
          'itemGuid': dropItems[i][0],
          'playerLocation': currentPortal.playerLocation
        };
        api.api('gameplay/dropItem', params, function(err, data) {
          if (err) {
            // console.log('error dropping bla=', dropItems[i][0]);
          } else {
            console.log('dropped item ('+ dropItems[i] +').');
          }
        });
      }
    }
  }
}
function filter(data) {
    return function (item) {
        if (typeof item[2].resourceWithLevels !== "undefined") {
            if (item[2].resourceWithLevels.resourceType === "EMITTER_A") {
                return data[0] === "EMITTER_A" && data[1] === item[2].resourceWithLevels.level;
            } else if (item[2].resourceWithLevels.resourceType === "EMP_BURSTER") {
                return data[0] === "EMP_BURSTER" && data[1] === item[2].resourceWithLevels.level;
            } else if (item[2].resourceWithLevels.resourceType === "MEDIA") {
                return data[0] === "MEDIA" && (typeof(data[1]) == 'undefined' || data[1] === item[2].resourceWithLevels.level);
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
*/
function fireBurster() {
  if(bursters.length == 0) {
    console.log("Ooops, ran out of XMPs. Let's try to hack some new items!");
    return hack();
  }
  var guid = bursters.shift();
  var params = {
    itemGuid: guid,
    playerLocation: getHexFromLat(currentPortal[2].locationE6)
  };
  // console.log(params);

  api.api('gameplay/fireUntargetedRadialWeapon', params, function(err, data) {
    if(err) {
      console.log('error firing burster. (', err, ')');
    } else {
      if(typeof(data.result) != 'undefined' && typeof(data.result.damages) != 'undefined') {
        var resonatorsDamaged = data.result.damages.length;
        var damageTotal = 0;
        var destroyed = true;

        data.result.damages.forEach(function(item) {
          damageTotal += Number(item.damageAmount);
          if(item.targetDestroyed == false) {
            destroyed = false;
          }
        });
        console.log('Fire Result: '+ guid +' made '+ damageTotal +' on '+ resonatorsDamaged +' resonators.');

        if(destroyed == false && damageTotal > 0) {
          fireBurster();
        } else {
          console.log("All Resonators destroyed: ", destroyed);
          deployResonator(getHexFromLat(currentPortal[2].locationE6));
        }
      } else {
        console.log("Are you out of XM?");
        handleNextPortal();
      }
    }
  });
};

function deployResonator(playerPosition) {
  var guid = resonators.shift();
  var params = {
    'itemGuids': [guid],
    'portalGuid': currentPortal[0],
    'preferredSlot': 255,
    'location': playerPosition
  };

  api.api('gameplay/deployResonatorV2', params, function(err, data) {
    if (err) {
      console.log('error deploying resonator. (', err, ')');
    } else {
      console.log("Resonator with guid '"+ guid +"' deployed, another new portal is online!");
      hack();
    }
  });
}

function handleInventoryItems() {
  bursters = inventory.map(function(item) {
    if(typeof item[2].empWeapon !== 'undefined') {
      if(item[2].empWeapon.level <= api.player.LEVEL) {
        return item[0];
      }
    }
    return false;
  });
  bursters = bursters.filter(function(item) { return item; });

  resonators = inventory.map(function(item) {
    if(typeof(item[2].resourceWithLevels) != 'undefined') {
      var current_item = item[2].resourceWithLevels;
      if(current_item.resourceType == 'EMITTER_A' && current_item.level == '1' && typeof(item[0]) != 'undefined') {
        return item[0];
      }
    }
  });
  resonators = resonators.filter(function(item) { return item; });
  console.log("Bursters: ", bursters.length);
  console.log("Resonators: ", resonators.length);
}

function getInventory(callback) {
  api.api('playerUndecorated/getInventory', {}, function(err, data) {
    if(err) {
      console.log(err, data);
    } else {
      inventory = data.gameBasket.inventory;
      callback();
    }
  });
}

function getHexFromLat(obj) {
  var val = '';
  var lat = obj.latE6.toString(16);
  var lng = obj.lngE6.toString(16);
  for(var i = 0; i < (8 - lat.length); i++) {
    lat = '0'+lat;
  }
  for(var i = 0; i < (8 - lng.length); i++) {
    lng = '0'+lng;
  }

  return lat +','+ lng;
}

function handleNextPortal() {
  console.log("Let's go to the next portal!");
  setTimeout(function() {
    if(portalsInCellRange.length > 0) {
      handlePortalsInRange(portalsInCellRange.shift());
    } else {
      portalNum++;
      start();
    }
  }, secondsBetweenActions * 1000);
}

function handlePortalsInRange(portal) {
  currentPortal = portal;
  if(typeof(portal[2].controllingTeam) != 'undefined') {
    if(portal[2].controllingTeam.team == 'NEUTRAL') {
      console.log("Neutral portal, let's deploy a resonator!");
      deployResonator(getHexFromLat(portal[2].locationE6));
    } else if(portal[2].controllingTeam.team == api.player.FACTION) {
      console.log("This portal belongs to your faction, hack it!");
      hack(portal);
      //dropNeedlessStuff();
    } else if(portal[2].controllingTeam.team != api.player.FACTION) {
      console.log("The enemy is nearby, FIRE!!!!");
      fireBurster(portal);
    }
  }
}

function handleInventory() {
  var cell_dates = [];
  for(var j = 0; j < celldata[portalNum].cellsAsHex.length; j++) {
    cell_dates.push(0);
  }
  celldata[portalNum].dates = cell_dates;
  currentCell = celldata[portalNum];
  getObjectsInCells(currentCell, function(portals) {
    handleInventoryItems();
    portalsInCellRange = portals;
    console.log("Portals in Range: ", portalsInCellRange.length);
    handlePortalsInRange(portalsInCellRange.shift());
  });
}
function refreshInventory() {
  getInventory(handleInventoryItems);
}

function start() {
  if(typeof(celldata[portalNum]) == 'undefined') {
    portalNum = 0;
  }
  getInventory(handleInventory);
}
start();

