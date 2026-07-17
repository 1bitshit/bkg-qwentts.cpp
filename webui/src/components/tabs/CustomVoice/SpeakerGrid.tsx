import React, { useEffect, useMemo, useState } from 'react';
import { SPEAKERS } from '../../../config/speakers';
import { cn } from '../../../utils/cn';
import { useTranslation } from '../../../i18n/I18nContext';

interface SpeakerGridProps {
  selectedSpeaker: string;
  onSelectSpeaker: (speaker: string) => void;
}

interface EngineVoice {
  name: string;
  kind: 'speaker' | 'registered';
  display_name?: string;
  description?: string;
  domain?: string;
}

function domainLabel(domain?: string): string {
  if (domain === 'talkshow') return 'Talkshow';
  if (domain === 'story') return 'Story';
  return 'Gemeinsam';
}

export function SpeakerGrid({ selectedSpeaker, onSelectSpeaker }: SpeakerGridProps) {
  const t = useTranslation();
  const [engineVoices, setEngineVoices] = useState<EngineVoice[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/v1/audio/voices')
      .then(async response => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
      .then(payload => {
        if (active) setEngineVoices(Array.isArray(payload.voices) ? payload.voices : []);
      })
      .catch(reason => {
        if (active) setError((reason as Error).message);
      });
    return () => { active = false; };
  }, []);

  const modelVoices = useMemo(
    () => engineVoices.filter(voice => voice.kind === 'speaker'),
    [engineVoices],
  );
  const registeredVoices = useMemo(
    () => engineVoices.filter(voice => voice.kind === 'registered'),
    [engineVoices],
  );

  const renderCard = (voice: EngineVoice, description: string, subtitle: string) => (
    <button
      type="button"
      key={voice.name}
      onClick={() => onSelectSpeaker(voice.name)}
      className={cn(
        'p-md bg-bg-surface border-2 rounded-md cursor-pointer transition-all text-left',
        selectedSpeaker === voice.name
          ? 'border-accent-cyan shadow-glow-cyan'
          : 'border-border-subtle hover:border-border-active hover:bg-bg-elevated',
      )}
    >
      <div className="font-display text-sm font-semibold text-text-primary mb-xs">
        {voice.display_name || voice.name.replaceAll('_', ' ')}
      </div>
      <div className="text-xs text-accent-cyan mb-xs">{subtitle}</div>
      <div className="text-xs text-text-muted leading-snug">{description}</div>
      <div className="text-[10px] text-text-muted mt-sm break-all">{voice.name}</div>
    </button>
  );
  return (
    <div className="space-y-lg">
      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-sm">Erzeugte Stimmen</h2>
        {registeredVoices.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-md">
            {registeredVoices.map(voice => renderCard(
              voice,
              voice.description || 'Dauerhafte Referenzstimme aus der nativen Registry.',
              domainLabel(voice.domain),
            ))}
          </div>
        ) : (
          <div className="p-md rounded-md border border-border-subtle text-sm text-text-muted">
            Noch keine erzeugten Stimmen registriert.
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text-primary mb-sm">Modellstimmen</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-md">
          {(modelVoices.length ? modelVoices : SPEAKERS.map(speaker => ({
            name: speaker.name,
            kind: 'speaker' as const,
            display_name: speaker.name.replace('_', ' '),
            description: t(`${speaker.i18nKey}Desc` as any),
            domain: speaker.native_language,
          }))).map(voice => renderCard(
            voice,
            voice.description || 'Eingebaute Modellstimme',
            voice.domain || 'Modell',
          ))}
        </div>
      </section>

      {error && <div className="text-xs text-accent-red">Stimmen konnten nicht geladen werden: {error}</div>}
    </div>
  );
}
