/**
 * Explicit lucide icon map (tree-shakeable; the registries reference icons by name).
 * Owner: design-system-hud — add every icon name used by the registries here.
 */
import {
  Activity, Anchor, Atom, Biohazard, Bluetooth, Bug, Building2, Cable, Camera, ChartBar, CloudLightning, CloudRain,
  Crosshair, Database, Earth, Flame, MapPin, Megaphone, Moon, Mountain, Navigation, Network, Newspaper, Orbit,
  PenLine, Plane, Radar, Radio, Route, Satellite, Scan, Search, ShieldAlert, Ship, Signal, Siren, Sun, TriangleAlert,
  Tv, Video, Waypoints, Wind, Zap, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  Activity, Anchor, Atom, Biohazard, Bluetooth, Bug, Building2, Cable, Camera, ChartBar, CloudLightning, CloudRain,
  Crosshair, Database, Earth, Flame, MapPin, Megaphone, Moon, Mountain, Navigation, Network, Newspaper, Orbit,
  PenLine, Plane, Radar, Radio, Route, Satellite, Scan, Search, ShieldAlert, Ship, Signal, Siren, Sun, TriangleAlert,
  Tv, Video, Waypoints, Wind, Zap,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Radar;
}
