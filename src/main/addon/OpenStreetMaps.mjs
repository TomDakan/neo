import Base       from './Base.mjs';
import DomAccess  from '../DomAccess.mjs';
import DomEvents  from '../DomEvents.mjs';
import Observable from '../../core/Observable.mjs';

/**
 * @class Neo.main.addon.OpenStreetMaps
 * @extends Neo.main.addon.Base
 * @mixes Neo.core.Observable
 */
class OpenStreetMaps extends Base {
    /**
     * True automatically applies the core.Observable mixin
     * @member {Boolean} observable=true
     * @static
     */
    static observable = true

    static config = {
        /**
         * @member {String} className='Neo.main.addon.OpenStreetMaps'
         * @protected
         */
        className: 'Neo.main.addon.OpenStreetMaps',

        interceptRemotes: [
            'addMarker',
            'destroyMarkers',
            'hideMarker',
            'panTo',
            'removeMap',
            'removeMarker',
            'setCenter',
            'setZoom',
            'showMarker'
        ],
        /**
         * @member {Object} remote
         * @protected
         */
        remote: {
            app: [
                'addMarker',
                'create',
                'destroyMarkers',
                'geocode',
                'hideMarker',
                'panTo',
                'removeMap',
                'removeMarker',
                'setCenter',
                'setZoom',
                'showMarker'
            ]
        }
    }

    /**
     * @member {Object} maps={}
     */
    maps = {}
    /**
     * @member {Object} markers={}
     */
    markers = {}
    /**
     * @member {Object} pendingInits={}
     * @protected
     */
    pendingInits = {}
    /**
     * @member {Object} vectorLayers={}
     */
    vectorLayers = {}
    /**
     * @member {Object} vectorSources={}
     */
    vectorSources = {}

    /**
     * @param {Object} data
     * @param {Object} [data.anchorPoint] x & y
     * @param {String} [data.icon]
     * @param {String} data.id
     * @param {String} [data.label]
     * @param {String} data.mapId
     * @param {Object} data.position
     * @param {String} [data.title]
     */
    addMarker(config, data) {
        let me      = this,
            {mapId} = config,
            marker;

        // Defensive check to prevent errors from stale/invalid remote calls.
        // This is the critical fix.
        if (!data.position) {
            console.warn('OpenStreetMaps.addMarker() called with invalid data. Missing position.', {config, data});
            return { success: false, error: 'Missing position data' };
        }

        // Create marker using OpenLayers
        marker = new ol.Feature({
            geometry: new ol.geom.Point([data.position.lng, data.position.lat]),
            neoId: data.id,
            label: data.label || '',
            title: data.title || ''
        });

        // Set custom properties if provided
        if (data.anchorPoint) {
            marker.set('anchorPoint', data.anchorPoint);
        }
        if (data.icon) {
            marker.set('icon', data.icon);
        }

        // IMPORTANT: Associate mapId with the feature for later cleanup
        marker.set('mapId', mapId);

        // Add the marker to the existing vector source
        me.vectorSources[mapId].addFeature(marker);

        // Store the marker in the markers object
        me.markers[data.id] = marker;

        // Fire an event for the app to listen to
        me.fire('markerAdded', {
            mapId: mapId,
            marker: { // Return a plain object, not the ol.Feature
                id: data.id
            }
        });

        return {
            success: true,
            mapId  : mapId,
            marker : {
                id      : data.id,
                position: data.position,
                title   : data.title,
                label   : data.label
            }
        };
    }

    /**
     * @param {Object} data
     * @param {Object} data.center
     * @param {Boolean} data.fullscreenControl
     * @param {String} data.id
     * @param {Object} data.mapOptions
     * @param {Number} data.maxZoom
     * @param {Number} data.minZoom
     * @param {Number} data.zoom
     * @param {Boolean} data.zoomControl
     */
    async create(data) {
        let me   = this,
            {id} = data,
            map, resolvePromise;

        me.pendingInits[id] = new Promise(resolve => {
            resolvePromise = resolve;
        });

        // Ensure OpenLayers is loaded first
        if (!globalThis.ol) {
            await me.loadFiles();
        }

        let mapElement = DomAccess.getElement(id);

        if (!mapElement) {
            console.error('Cannot create map, element not found:', id);
            resolvePromise({success: false, error: 'Target element not found'});
            return; // Return here is fine, but the promise must be resolved.
        }

        // Create the vector source and layer for markers
        me.vectorSources[id] = new ol.source.Vector();
        me.vectorLayers[id]  = new ol.layer.Vector({
            source: me.vectorSources[id],
            style : (feature) => {
                const icon = feature.get('icon');

                if (feature.get('hidden') || !icon) {
                    return null; // Hide feature if hidden or no icon is provided
                }
                // Handle icon as a URL string
                if (typeof icon === 'string') {
                    return new ol.style.Style({
                        image: new ol.style.Icon({
                            anchor: feature.get('anchorPoint') || [0.5, 1],
                                                       src   : icon
                        })
                    });
                }

                // Handle icon as a style object
                if (typeof icon === 'object' && icon.shape === 'circle') {
                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            fill: new ol.style.Fill({
                                color: icon.fillColor || 'blue'
                            }),
                            radius: icon.radius || 5,
                            stroke: new ol.style.Stroke({
                                color: icon.strokeColor || 'white',
                                width: icon.strokeWidth || 1
                            })
                        })
                    });
                }
                return me.getDefaultMarkerStyle(); // Fallback to default
            }
        });

        me.maps[id] = map = new ol.Map({
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.OSM()
                }),
                me.vectorLayers[id] // Add marker layer to the map
            ],
            target: mapElement,
            view  : new ol.View({
                center : [data.center.lng, data.center.lat],
                maxZoom: data.maxZoom,
                minZoom: data.minZoom,
                zoom   : data.zoom
            }),
            ...data.mapOptions
        });

        map.on('moveend', event => me.onMapZoomChange(map, id));

        // Add click listener for markers
        map.on('click', event => {
            map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
                me.onMarkerClick(feature, event);
            });
        });

        resolvePromise({success: true});
    }

    /**
     * @param {Object} data
     * @param {String} data.mapId
     */
    destroyMarkers(data) {
        let me           = this,
            {mapId}      = data,
            vectorSource = me.vectorSources[mapId];

        if (vectorSource) {
            vectorSource.clear();
        }

        // Clear out the markers object for the given mapId
        Object.keys(me.markers).forEach(markerId => {
            if (me.markers[markerId].get('mapId') === mapId) {
                delete me.markers[markerId];
            }
        });
    }

    /**
     * @param {Object} data
     * @param {String} data.address
     * @param {Object} data.location
     * @param {String} data.placeId
     * @returns {Object}
     */
    async geocode(data) {
        const {address, mapId} = data;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=5`;

        try {
            // Nominatim requires a User-Agent header.
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Neo.mjs OpenStreetMaps Addon'
                }
            });

            if (!response.ok) {
                throw new Error(`Nominatim API request failed with status ${response.status}`);
            }

            const results = await response.json();

            const features = results.map(item => ({
                id         : item.place_id,
                displayName: item.display_name,
                position   : {
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon)
                },
                boundingBox: item.boundingbox // [south, north, west, east]
            }));

            return {success: true, mapId, features};

        } catch (error) {
            console.error('Geocoding error:', error);
            // Return an empty features array on error to prevent crashes in the calling component.
            return {success: false, mapId, error: error.message, features: []};
        }
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     */
    hideMarker(data) {
        let {id}   = data,
            marker = this.markers[id];

        if (marker) {
            marker.set('hidden', true);

            const mapId = marker.get('mapId');
            if (mapId && this.vectorLayers[mapId]) {
                // Force the layer to re-evaluate styles and re-render
                this.vectorLayers[mapId].changed();
            }
            return {success: true};
        }

        return {success: false, error: 'Marker not found'};
    }

    /**
     * @protected
     */
    async loadFiles() {
        await super.loadFiles();

        let version  = Neo.config.openLayersVersion || '10.6.1',
            basePath = Neo.config.openLayersBasePath || `https://cdn.jsdelivr.net/npm/ol@${version}`,
            cssUrl   = `${basePath}/ol.css`,
            jsUrl    = `${basePath}/dist/ol.js`;

        try {
            await Promise.all([
                DomAccess.loadStylesheet(cssUrl),
                DomAccess.loadScript(jsUrl)
            ]);
            
            // Verify OpenLayers loaded successfully
            if (typeof ol === 'undefined' || !ol.Map || !ol.source || !ol.source.OSM) {
                throw new Error('OpenLayers failed to load completely');
            }
            
            // Configure OpenLayers to use geographic coordinates (WGS84) in all API methods
            // This allows us to work with lat/lng directly without manual transformations
            ol.proj.useGeographic();
            
        } catch (error) {
            console.error('Failed to load OpenLayers:', error);
            throw error;
        }
    }

    /**
     * @param {ol.Map} map
     * @param {String} mapId
     */
    onMapZoomChange(map, mapId) {
        let me = this,
            view = map.getView(),
            currentZoom = view.getZoom(),
            center = view.getCenter();
        
        // Center coordinates are already in WGS84 format due to useGeographic()
        let centerLatLng = {
            lng: center[0],
            lat: center[1]
        };

        // Fire zoom change event that apps can listen to
        me.fire('zoomChanged', {
            mapId: mapId,
            zoom: currentZoom,
            center: centerLatLng
        });

        // Store current zoom level for reference
        if (!me.maps[mapId].neoData) {
            me.maps[mapId].neoData = {};
        }
        me.maps[mapId].neoData.currentZoom = currentZoom;
        me.maps[mapId].neoData.currentCenter = centerLatLng;
    }

    /**
     * @param {ol.Feature} feature
     * @param {Object} event
     */
    onMarkerClick(feature, event) {
        let me         = this,
            coords     = feature.getGeometry().getCoordinates(),
            featureId  = feature.get('neoId'),
            mapId      = event.map.getTarget().id;

        // Fire an event that the component instance can listen for.
        // It's crucial to send a complete, serializable data object.
        me.fire('markerClick', {
            mapId   : mapId,
            markerId: featureId,
            position: {
                lng: coords[0],
                lat: coords[1]
            }
        });
    }

    /**
     * @param {Object} data
     * @param {String} data.mapId
     * @param {Object} data.position - Position object with lat/lng
     * @param {Number} data.position.lat - Latitude
     * @param {Number} data.position.lng - Longitude
     * @param {Number} [data.duration] - Animation duration in milliseconds (default: 1000)
     */
    async panTo(data) {
        let {mapId, position, duration = 1000} = data,
            map                               = this.maps[mapId];

        map.getView().animate({
            center  : [position.lng, position.lat],
            duration: duration
        });
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     */
    async removeMap(data) {
        let {mapId} = data,
            map     = this.maps[mapId];

        if (map) {
            map.setTarget(null);
            delete this.maps[mapId];
            delete this.vectorSources[mapId];
            delete this.vectorLayers[mapId];
            // Further cleanup if needed
        }
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     */
    async removeMarker(data) {
        let {id, mapId} = data,
            marker       = this.markers[id],
            vectorSource = this.vectorSources[mapId];

        if (marker && vectorSource) {
            vectorSource.removeFeature(marker);
            delete this.markers[id];
        }
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     * @param {Object} data.value
     */
    async setCenter(data) {
        let {id: mapId, value} = data,
            map                = this.maps[mapId];

        map.getView().setCenter([value.lng, value.lat]);
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     * @param {Number} data.value - The zoom level to set
     * @param {Number} [data.duration] - Animation duration in milliseconds (default: 1000)
     */
    async setZoom(data) {
        let {id: mapId, value, duration = 1000} = data,
            map                                 = this.maps[mapId];

        map.getView().animate({
            zoom    : value,
            duration: duration
        });
    }

    /**
     * @param {Object} data
     * @param {String} data.id
     * @param {String} data.mapId
     */
    showMarker(data) {
        let {id}   = data,
            marker = this.markers[id];

        if (marker) {
            marker.set('hidden', false);

            const mapId = marker.get('mapId');
            if (mapId && this.vectorLayers[mapId]) {
                // Force the layer to re-evaluate styles and re-render
                this.vectorLayers[mapId].changed();
            }
            return {success: true};
        }

        return {success: false, error: 'Marker not found'};
    }

    /**
     * Get default marker style for OpenLayers
     * @returns {ol.style.Style}
     * @protected
     */
    getDefaultMarkerStyle() {
        return new ol.style.Style({
            image: new ol.style.Icon({
                anchor: [0.5, 1],
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
                src: 'data:image/svg+xml;base64,' + btoa(`
                    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path fill="#FF0000" stroke="#FFFFFF" stroke-width="2" 
                              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                        <circle fill="#FFFFFF" cx="12" cy="9" r="3"/>
                    </svg>
                `)
            })
        });
    }

    /**
     * Intercepts remote method calls to ensure proper initialization order
     * @param {String} remote
     * @param {Object} data
     * @returns {Promise<any>}
     */
    async interceptRemote(remote, data) {
        let me    = this,
            mapId = data.mapId || data.id;

        // For methods that depend on a map, wait for it to be initialized.
        if (mapId && !me.maps[mapId]) {
            await me.pendingInits[mapId];
        }

        // Proceed with the original method call
        return me[remote](data);
    }
}

export default Neo.setupClass(OpenStreetMaps);