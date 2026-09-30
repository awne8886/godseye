'use client';
/**
 * WORLD REMOTE: connect to ONE Bluetooth Low Energy device the visitor picks in the browser's own
 * Web Bluetooth chooser, and read its standard Battery and Device Information services. The tool
 * is offered only when `navigator.bluetooth` exists. Honest scope: nothing is scanned, no local
 * network or localhost ports are probed, no WebRTC address harvesting, nothing leaves the
 * browser. Owner: panels-recon.
 */
import { Bluetooth, BluetoothOff, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import { HudButton, KeyValues, Prose } from '../recon/ui';

/** Minimal Web Bluetooth surface (the DOM lib does not ship these types). */
interface BtCharacteristic {
  readValue(): Promise<DataView>;
}
interface BtService {
  getCharacteristic(name: string): Promise<BtCharacteristic>;
}
interface BtServer {
  connected: boolean;
  getPrimaryService(name: string): Promise<BtService>;
  disconnect(): void;
}
interface BtDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<BtServer> };
}
interface BtApi {
  requestDevice(opts: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BtDevice>;
}

export const bluetoothApi = (): BtApi | null => (typeof navigator !== 'undefined' && 'bluetooth' in navigator ? (navigator as unknown as { bluetooth: BtApi }).bluetooth : null);

const DEVICE_INFO = ['manufacturer_name_string', 'model_number_string', 'firmware_revision_string', 'hardware_revision_string'] as const;

async function readInfo(server: BtServer): Promise<Record<string, string | number | null>> {
  const out: Record<string, string | number | null> = {};
  try {
    const bat = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
    out.battery = `${(await bat.readValue()).getUint8(0)}%`;
  } catch {
    out.battery = null;
  }
  try {
    const svc = await server.getPrimaryService('device_information');
    for (const c of DEVICE_INFO) {
      try {
        out[c.replace(/_string$/, '').replace(/_/g, ' ')] = new TextDecoder().decode(await (await svc.getCharacteristic(c)).readValue());
      } catch {
        /* characteristic not offered by this device */
      }
    }
  } catch {
    /* service not offered by this device */
  }
  return out;
}

export default function RemotePanel(_: PanelProps) {
  const api = bluetoothApi();
  const [state, setState] = useState<'idle' | 'choosing' | 'connected' | 'error'>('idle');
  const [device, setDevice] = useState<{ name: string; info: Record<string, string | number | null> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const server = useRef<BtServer | null>(null);
  usePanelChip(state === 'connected' ? 'CONNECTED' : state === 'choosing' ? 'PAIRING' : 'STANDBY', state === 'connected' ? 'live' : state === 'choosing' ? 'busy' : state === 'error' ? 'warn' : 'idle');
  useEffect(() => () => server.current?.disconnect(), []);

  if (!api) {
    return (
      <div className="flex flex-col gap-2" data-testid="remote-panel">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          <BluetoothOff size={14} aria-hidden /> Web Bluetooth unavailable
        </p>
        <Prose>This browser does not offer Web Bluetooth, so World Remote is off. Nothing else is attempted.</Prose>
      </div>
    );
  }

  const connect = async () => {
    setError(null);
    setState('choosing');
    try {
      // The browser shows its own chooser; only the device the visitor picks is exposed.
      const d = await api.requestDevice({ acceptAllDevices: true, optionalServices: ['battery_service', 'device_information'] });
      const s = await d.gatt?.connect();
      if (!s) throw new Error('This device does not offer GATT services.');
      server.current = s;
      d.addEventListener('gattserverdisconnected', () => {
        setState('idle');
        setDevice(null);
      });
      setDevice({ name: d.name || 'Unnamed device', info: await readInfo(s) });
      setState('connected');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Connection cancelled.');
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="remote-panel">
      <Prose>
        Connects to one Bluetooth device you choose in your browser&rsquo;s own picker and reads its battery and device-information services. The connection stays in your browser; nothing is scanned, sent to this server or probed on your network.
      </Prose>
      {state !== 'connected' ? (
        <HudButton tone="cyan" onClick={connect} disabled={state === 'choosing'}>
          <Bluetooth size={14} aria-hidden /> {state === 'choosing' ? 'Waiting for your choice…' : 'Choose a device'}
        </HudButton>
      ) : (
        <HudButton
          tone="muted"
          onClick={() => {
            server.current?.disconnect();
            setState('idle');
            setDevice(null);
          }}
        >
          <Unplug size={14} aria-hidden /> Disconnect
        </HudButton>
      )}
      {error && (
        <p role="status" className="font-sans text-[12px] text-[var(--alert-orange)]">
          {error}
        </p>
      )}
      {device && (
        <section aria-label="Connected device" className="flex flex-col gap-1">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">{device.name}</h3>
          <KeyValues data={device.info} />
        </section>
      )}
    </div>
  );
}
