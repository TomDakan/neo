import Base            from '../Base.mjs';
import ClassSystemUtil from '../../util/ClassSystem.mjs';
import Store           from '../../data/Store.mjs';

/**
 * @class Neo.component.wrapper.OpenStreetMaps
 * @extends Neo.component.Base
 */
class OpenStreetMaps extends Base {

    static config = {
        /**
         * @member {String} className='Neo.component.wrapper.OpenStreetMaps'
         * @protected
         */
        className: 'Neo.component.wrapper.OpenStreetMaps',
        /**
         * @member {String} ntype='openstreetmaps'
         * @protected
         */
        ntype: 'openstreetmaps',
        /**
         * Specify lat & lng for the current focus position
         * @member {Object} center_={lat: -34.397, lng: 150.644}
         * @reactive
         */
        center_: {lat: -34.397, lng: 150.644},
        /**
         * The store containing the marker data.
         * @member {Neo.data.Store|Object} markerStore_
         * @protected
         * @reactive
         */
        markerStore_: {
            autoLoad: false,
            model: {
                fields: [{
                    name: 'id'
                }, {
                    name: 'humanReadableLocation',
                    mapping: 'humanReadableLocation'
                }, {
                    name: 'latitude',
                    mapping: 'latitude'
                }, {
                    name: 'longitude',
                    mapping: 'longitude'
                }, {
                    name: 'position',
                    convert(value, record) {
                        return {
                            lat: record.data.latitude,
                            lng: record.data.longitude
                        }
                    }
                }, {
                    name: 'timestamp',
                    mapping: 'timestamp'
                }, {
                    name: 'title',
                    convert(value, record) {
                        return `${new Date(record.data.timestamp).toLocaleDateString()}, ${record.data.humanReadableLocation}`
                    }
                }]
            },
            proxy: {
                reader: {
                    rootProperty: 'results'
                }
            }
        },
        /**
         * @member {Object|null} markerStoreConfig=null
         */
        markerStoreConfig: null,
        /**
         * null => the maximum zoom from the current map type is used instead
         * @member {Number|null} maxZoom=null
         */
        maxZoom: null,
        /**
         null => the minimum zoom from the current map type is used instead
         * @member {Number|null} minZoom=null
         */
        minZoom: null,
        /**
         * false hides the default zoom control
         * @member {Boolean} zoomControl=true
         */
        zoomControl: true
    }

    /**
     * false hides the default fullscreen control
     * @member {Boolean} fullscreenControl=true
     */
    fullscreenControl = true
    /**
     * Internal flag. Gets set to true once Neo.main.addon.OpenStreetMaps.create() is finished.
     * @member {Boolean} mapCreated=false
     */
    mapCreated = false
    /**
     * Pass any options to the map instance which are not explicitly defined here
     * @member {Object} mapOptions={}
     */
    mapOptions = {}
    /**
     * @member {Number|null} zoom=12
     */
    zoom = 12

    /**
     * @param {Object} config
     */
    construct(config) {
        super.construct(config);

        let me = this;

        me.addDomListeners({
            omsMapZoomChange : me.onMapZoomChange,
            omsMarkerClick   : me.parseMarkerClick,
            local            : false,
            scope            : me
        });
    }

    /**
     * Triggered after the mounted config got changed
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetMounted(value, oldValue) {
        super.afterSetMounted(value, oldValue);

        if (value) {
            let me = this;
            me.loader = true;

            Neo.main.addon.OpenStreetMaps.create({
                center           : me.center,
                fullscreenControl: me.fullscreenControl,
                id               : me.id,
                mapOptions       : me.mapOptions,
                maxZoom          : me.maxZoom,
                minZoom          : me.minZoom,
                zoom             : me.zoom,
                zoomControl      : me.zoomControl
            }).then(() => {
                me.mapCreated = true;
                me.loader = false;

                if (me.markerStore?.proxy?.url) {
                    me.markerStore.load();
                }
            }).catch(e => {
                console.error('Error during map setup', e);
                me.loader = false;
            });
        }
    }

    /**
     * Triggered after the center config got changed
     * @param {Object} value
     * @param {Object} oldValue
     * @protected
     */
    afterSetCenter(value, oldValue) {
        if (this.mounted && value) {
            Neo.main.addon.OpenStreetMaps.setCenter({
                id   : this.id,
                value: value
            });
        }
    }

    /**
     * Triggered after the markerStore config gets changed.
     * @param {Neo.data.Store} value
     * @param {Neo.data.Store} oldValue
     * @protected
     */
    afterSetMarkerStore(value, oldValue) {
        value.on({
            load : this.onMarkerStoreLoad,
            scope: this
        });
    }

    /**
     * Triggered after the zoom config got changed
     * @param {Number} value
     * @param {Number} oldValue
     * @protected
     */
    afterSetZoom(value, oldValue) {
        if (this.mounted && value) {
            Neo.main.addon.OpenStreetMaps.setZoom({
                id   : this.id,
                value: value
            });
        }
    }
    
    /**
     * Triggered before the markerStore config gets changed.
     * @param {Object} value
     * @param {Object} oldValue
     * @protected
     */
    beforeSetMarkerStore(value, oldValue) {
        oldValue?.destroy();

        if (value?.isStore) {
            return value;
        }

        const storeConfig = Neo.merge(
            Neo.clone(this.markerStore_),
            this.markerStoreConfig,
            value || {}
        );

        if (storeConfig.url) {
            storeConfig.proxy = storeConfig.proxy || {};
            storeConfig.proxy.url = storeConfig.url;
            delete storeConfig.url;
        }

        return Neo.create(Store, storeConfig);
    }

    /**
     * @param {Boolean} updateParentVdom=false
     * @param {Boolean} silent=false
     */
    destroy(updateParentVdom=false, silent=false) {
        this.removeMap();
        super.destroy(updateParentVdom, silent)
    }

    /**
     * @param {Object} data
     */
    onMapZoomChange(data) {
        this.zoom = data.value
    }

    /**
     * Gets triggered when the markerStore loads.
     * @param {Neo.data.Store} store The store instance
     */
    onMarkerStoreLoad(store) {
        if (this.mapCreated) {
            let me = this;

            store.items.forEach(record => {
                Neo.main.addon.OpenStreetMaps.addMarker({
                    appName : me.appName,
                    mapId   : me.id,
                    windowId: me.windowId
                }, record.data);
            });
        }
    }

    /**
     * Internal function. Use onMarkerClick() or the markerClick event instead
     * @param {Object} data
     * @protected
     */
    parseMarkerClick(data) {
        let me = this;

        data.record = me.markerStore.get(data.id);

        me.onMarkerClick?.(data);

        me.fire('markerClick', {id: me.id, data})
    }

    /**
     *
     */
    removeMap() {
        let {appName, id, windowId} = this;

        Neo.main.addon.OpenStreetMaps.removeMap({
            appName,
            mapId: id,
            windowId
        })
    }
}

export default Neo.setupClass(OpenStreetMaps);
