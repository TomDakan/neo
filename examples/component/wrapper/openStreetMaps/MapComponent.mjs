import OpenStreetMapsComponent from '../../../../src/component/wrapper/OpenStreetMaps.mjs';
import MarkerDialog        from './MarkerDialog.mjs';

/**
 * @class Neo.examples.component.wrapper.OpenStreetMaps.MapComponent
 * @extends Neo.component.wrapper.OpenStreetMaps
 */
class MapComponent extends OpenStreetMapsComponent {
    static config = {
        className: 'Neo.examples.component.wrapper.openStreetMaps.MapComponent',
        center: {
            lat: 64.963051,
            lng: -19.020835
        },
        // The markerStoreConfig should only specify what is unique to this instance,
        // like the URL. The model definition should be inherited from the wrapper.
        markerStoreConfig: {
            url: './earthquakes.json'
        },
        zoom: 6
    }

    /**
     * The onConstructed method is the correct lifecycle hook to trigger
     * data loading, as it runs after the parent component has created
     * all necessary instances, like the markerStore.
     */
    onConstructed() {
        super.onConstructed();
        this.fetchData();
    }

    /**
     * Ajax request to get the Marker Data
     */
    fetchData() {
        fetch('../../../../examples/component/wrapper/openStreetMaps/earthquakes.json')
            .then(response => response.json())
            .catch(err => console.log("Can't access  + url, err"))
            .then(data => this.createMarkersAndAddToMarkerStore(data))
    }

    /**
     * Create Marker records from the Server result and add all Markers to the MarkerStore
     * @param {Object} data from earthquake.json
     */
    createMarkersAndAddToMarkerStore(data) {
        let date, icon;

        const markers = data.results.map(record => {
            date = new Date(record.timestamp).toLocaleDateString('default', {
                day   : 'numeric',
                hour  : 'numeric',
                hour12: true,
                minute: 'numeric',
                month : 'short',
                year  : 'numeric'
            });

            // Create a style object for the marker.
            // The addon will use this to render a dynamic circle.
            icon = {
                shape    : 'circle',
                fillColor: 'rgba(255, 20, 20, 0.5)',
                radius   : Math.max(5, record.size * 5) // Dynamic radius based on earthquake size
            };
            // Create a single Marker
            return {
                icon,
                position: {lat: record.latitude, lng: record.longitude}, //openlayers expects lng/lat
                record,
                title   : `${date}, ${record.humanReadableLocation}`
            }
        });

        this.markerStore.add(markers);
    }

    /**
     * @param {Object} data
     */
    onMarkerClick(data) {
        let me     = this,
            record = data.record.record;

        me.disabled = true;

        me.dialog = Neo.create(MarkerDialog, {
            appName             : me.appName,
            boundaryContainerId : me.id,
            domEvent            : data.domEvent,
            record,

            listeners: {
                close: () => me.disabled = false
            }
        });
    }
}

export default Neo.setupClass(MapComponent);
