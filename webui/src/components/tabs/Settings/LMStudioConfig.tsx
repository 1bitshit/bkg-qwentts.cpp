import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';

export function LMStudioConfig() {
  const toast = useToast();
  const [storyKey, setStoryKey] = useState(() => localStorage.getItem('story-api-key') || '');
  const [debateKey, setDebateKey] = useState(() => localStorage.getItem('debate-api-key') || '');
  const [storyModel, setStoryModel] = useState(() => localStorage.getItem('story-model') || 'qwen3-14b-128k');
  const [debateModel, setDebateModel] = useState(() => localStorage.getItem('debate-model') || 'qwen3-14b-128k');
  const [models, setModels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  const saveSettings = () => {
    localStorage.setItem('story-api-key', storyKey.trim());
    localStorage.setItem('debate-api-key', debateKey.trim());
    localStorage.setItem('story-model', storyModel);
    localStorage.setItem('debate-model', debateModel);
    toast.showToast('LM-Studio- und API-Key-Einstellungen gespeichert', 'success');
  };

  const checkConnection = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/v1/lms/models');
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(data.detail || data.error || 'LM-Studio-Bridge nicht erreichbar');
      const names = (data.models || []).map((model: any) => model.id || model.displayName || model.path).filter(Boolean);
      setModels(Array.from(new Set(names)) as string[]);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setModels([]);
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);

  return (
    <div className="p-lg bg-bg-surface border border-border-subtle rounded-lg space-y-md">
      <h3 className="font-display text-sm font-semibold text-text-primary flex items-center gap-sm">
        <Cpu className="w-4 h-4" /> LM Studio über lokale lmstudio-js Bridge
      </h3>
      <div className="flex items-center gap-sm p-sm rounded-md bg-bg-surface/50">
        {connected ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-red-400" />}
        <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected ? 'Verbunden' : 'Nicht verbunden'}</span>
        <button onClick={() => void checkConnection()} disabled={loading} className="ml-auto p-xs rounded hover:bg-bg-elevated">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="text-xs text-text-secondary">
        Die WebUI verwendet Same-Origin-HTTP. WebSocket und lmstudio-js bleiben intern auf dem Server.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <div><label className="block text-xs text-text-secondary mb-xs">Story API Key</label><input type="password" value={storyKey} onChange={e => setStoryKey(e.target.value)} className="w-full px-sm py-xs rounded bg-bg-surface border border-border-subtle" /></div>
        <div><label className="block text-xs text-text-secondary mb-xs">Debatten API Key</label><input type="password" value={debateKey} onChange={e => setDebateKey(e.target.value)} className="w-full px-sm py-xs rounded bg-bg-surface border border-border-subtle" /></div>
        <div><label className="block text-xs text-text-secondary mb-xs">Story-Modell</label><select value={storyModel} onChange={e => setStoryModel(e.target.value)} className="w-full px-sm py-xs rounded bg-bg-surface border border-border-subtle"><option value="">Modell auswählen</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
        <div><label className="block text-xs text-text-secondary mb-xs">Debatten-Modell</label><select value={debateModel} onChange={e => setDebateModel(e.target.value)} className="w-full px-sm py-xs rounded bg-bg-surface border border-border-subtle"><option value="">Modell auswählen</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
      </div>
      <button onClick={saveSettings} className="px-md py-sm rounded bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30">Einstellungen speichern</button>
    </div>
  );
}
