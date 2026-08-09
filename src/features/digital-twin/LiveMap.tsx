// Real Google Map for the Digital Twin area-select screen — replaces the fixed-position marker
// set with live tiles, the farmer's actual live location, and the simulated Community Pest Watch
// network overlaid as markers. Falls back to the existing `DistrictMap` SVG (unchanged, still
// fully functional) whenever `VITE_GOOGLE_MAPS_API_KEY` is unset or the script fails to load —
// see `services/maps/googleMapsLoader.ts`. Every score/color a branch marker uses still comes
// from `engine/digitalTwin/healthModel.assessArea`; this component only lays out what the engine
// and the community-alert engine already decided.

import { useEffect, useRef, useState } from 'react'
import type { MonitoringArea } from '../../domain/digitalTwin/models'
import type { SimulatedCommunityFarmer } from '../../domain/digitalTwin/communityModels'
import { assessArea } from '../../engine/digitalTwin/healthModel'
import { getDigitalTwinCrop } from '../../data/sample/digitalTwinCrops'
import { loadGoogleMaps } from '../../services/maps/googleMapsLoader'
import { getLiveLocation, type LiveLocation } from '../../services/geolocation/liveLocation'
import { DistrictMap } from './DistrictMap'

const CITY = { lat: 11.0168, lng: 76.9558 }

export interface LiveMapProps {
  areas: MonitoringArea[]
  onPick: (areaId: string) => void
  visibleAreaIds?: Set<string> | null
  communityFarmers: SimulatedCommunityFarmer[]
}

type LoadState = 'loading' | 'unavailable' | 'ready'

export function LiveMap({ areas, onPick, visibleAreaIds = null, communityFarmers }: LiveMapProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [liveLocation, setLiveLocation] = useState<LiveLocation | null>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps().then((api) => {
      if (cancelled) return
      setLoadState(api ? 'ready' : 'unavailable')
    })
    getLiveLocation().then((loc) => {
      if (!cancelled) setLiveLocation(loc)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Create the map instance once Maps has loaded and the container div exists.
  useEffect(() => {
    if (loadState !== 'ready' || !mapDivRef.current || mapRef.current) return
    mapRef.current = new google.maps.Map(mapDivRef.current, {
      center: liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : CITY,
      zoom: liveLocation ? 12 : 10,
      disableDefaultUI: true,
      zoomControl: true,
      styles: DARK_MAP_STYLE,
    })
  }, [loadState, liveLocation])

  // Re-center once live location resolves after the map already exists.
  useEffect(() => {
    if (!mapRef.current || !liveLocation) return
    mapRef.current.panTo({ lat: liveLocation.lat, lng: liveLocation.lng })
    mapRef.current.setZoom(12)
  }, [liveLocation])

  // (Re)draw every marker whenever the underlying data changes. Markers are cheap enough at this
  // scale (2 branches + 30 simulated farmers + 1 "you are here") that clear-and-redraw is simpler
  // and just as fast as diffing.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []

    for (const area of areas) {
      const summary = assessArea(area.fields.map((field) => ({ field, crop: getDigitalTwinCrop(field.cropId)! })))
      const dim = visibleAreaIds != null && !visibleAreaIds.has(area.id)
      const marker = new google.maps.Marker({
        map,
        position: { lat: area.coords[0], lng: area.coords[1] },
        title: `${area.name} — ${summary.score}% ${summary.band.label}`,
        opacity: dim ? 0.35 : 1,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: summary.band.color,
          fillOpacity: 1,
          strokeColor: '#0a1016',
          strokeWeight: 2,
        },
        label: { text: area.name.replace(' Branch', ''), color: '#F2F2F3', fontSize: '11px', fontWeight: '700', className: 'dmap-gm-branch-label' },
        zIndex: 50,
      })
      marker.addListener('click', () => onPick(area.id))
      markersRef.current.push(marker)
    }

    for (const farmer of communityFarmers) {
      const hasReport = farmer.activePestReport !== null
      const crop = getDigitalTwinCrop(farmer.cropId)
      const marker = new google.maps.Marker({
        map,
        position: { lat: farmer.lat, lng: farmer.lng },
        title: hasReport
          ? `Nearby farmer growing ${crop?.name ?? farmer.cropId} — reporting ${farmer.activePestReport!.pestName}`
          : `Nearby farmer growing ${crop?.name ?? farmer.cropId}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: hasReport ? 6 : 4,
          fillColor: hasReport ? '#EA4335' : '#9AA0A6',
          fillOpacity: hasReport ? 0.95 : 0.55,
          strokeColor: '#0a1016',
          strokeWeight: 1,
        },
        zIndex: hasReport ? 30 : 10,
      })
      markersRef.current.push(marker)
    }

    if (liveLocation) {
      const marker = new google.maps.Marker({
        map,
        position: { lat: liveLocation.lat, lng: liveLocation.lng },
        title: `You are here (±${Math.round(liveLocation.accuracyM)}m)`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
        },
        zIndex: 100,
      })
      markersRef.current.push(marker)
    }
  }, [areas, communityFarmers, liveLocation, visibleAreaIds, onPick])

  // Tear markers down on unmount.
  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.setMap(null))
      markersRef.current = []
    }
  }, [])

  if (loadState !== 'ready') {
    return <DistrictMap areas={areas} onPick={onPick} visibleAreaIds={visibleAreaIds} />
  }

  return (
    <div className="dmap-panel">
      <div className="dmap-head">
        <span className="dmap-title">
          <i>▚</i> Live Map
        </span>
        <span className="dmap-sub">
          {liveLocation ? 'Centered on your live location' : 'Coimbatore district'} · {communityFarmers.filter((f) => f.activePestReport).length} active nearby reports
        </span>
      </div>
      <div className="dmap-stage" ref={mapDivRef} />
    </div>
  )
}

// A dark map style so the live map reads as one continuous surface with the rest of this dark
// panel, matching the existing DistrictMap SVG's #0a1016 backdrop rather than clashing with a
// bright default Google Maps theme.
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f26' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1016' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a9199' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2c333b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c333b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1a24' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

export default LiveMap
