import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { FormTextarea } from '../../forms/FormTextarea';
import { FormSelect } from '../../forms/FormSelect';
import { RangeSlider } from '../../forms/RangeSlider';
import { Button } from '../../ui/Button';
import { AudioPlayer } from '../../audio/AudioPlayer';
import { GenerationProgress } from '../../ui/GenerationProgress';
import { ExamplePrompts } from './ExamplePrompts';
import { useAppContext } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import { useTranslation } from '../../../i18n/I18nContext';
import { generateVoiceDesign, streamVoiceDesign } from '../../../services/api';
import { playPcmProducer } from '../../../services/audioRuntime';
import { base64ToBlob } from '../../../utils/audio';

export function VoiceDesignTab() {
  const t = useTranslation();
  const { apiKey, voiceDesignAudio, setVoiceDesignAudio } = useAppContext();
  const { showToast } = useToast();

  const [instruct, setInstruct] = useState(t('defaultInstructVoiceDesign'));
  const [text, setText] = useState(t('defaultTextVoiceDesign'));
  const [language, setLanguage] = useState('English');
  const [speed, setSpeed] = useState(1.0);
  const [progress, setProgress] = useState({ percent: 0, label: 'Bereit' });
  const [deliveryMode, setDeliveryMode] = useState<'wav' | 'stream'>('wav');

  const handleGenerate = async () => {
    if (!text.trim()) {
      showToast(t('noText'), 'warning');
      return;
    }

    if (!instruct.trim()) {
      showToast(t('noVoiceDesc'), 'warning');
      return;
    }

    if (!apiKey) {
      showToast(t('noApiKey'), 'warning');
      return;
    }

    setVoiceDesignAudio({ ...voiceDesignAudio, isLoading: true });
    setProgress({ percent: 5, label: 'Stimmprofil wird vorbereitet' });
    const startTime = performance.now();

    try {
      if (deliveryMode === 'stream') {
        setProgress({ percent: 25, label: 'Live-PCM wird gestartet' });
        await playPcmProducer((onChunk) => streamVoiceDesign({ text, language, instruct, speed }, apiKey, onChunk));
        setVoiceDesignAudio({ ...voiceDesignAudio, isLoading: false });
        showToast('Live-PCM-Streaming abgeschlossen', 'success');
        return;
      }
      setProgress({ percent: 30, label: 'Stimmdesign wird erzeugt' });
      const { data, headers } = await generateVoiceDesign(
        {
          text,
          language,
          instruct,
          speed,
          response_format: 'base64',
        },
        apiKey
      );

      setProgress({ percent: 85, label: 'WAV wird verarbeitet' });
      const genTime = (performance.now() - startTime) / 1000;
      const audioBlob = base64ToBlob(data.audio, 'audio/wav');
      const url = URL.createObjectURL(audioBlob);

      setVoiceDesignAudio({
        url,
        metrics: {
          generationTime: genTime,
          audioDuration: parseFloat(headers.get('x-audio-duration') || '0'),
          rtf: parseFloat(headers.get('x-rtf') || '0'),
        },
        isLoading: false,
      });

      setProgress({ percent: 100, label: 'Stimmdesign fertig' });
      showToast(t('generated'), 'success');
    } catch (error) {
      setProgress({ percent: 100, label: 'Fehler beim Stimmdesign' });
      showToast((error as Error).message, 'error');
      setVoiceDesignAudio({ ...voiceDesignAudio, isLoading: false });
    }
  };

  return (
    <div>
      <div className="mb-xl">
        <h1 className="text-2xl mb-sm text-text-primary">{t('vdTitle')}</h1>
        <p className="text-text-secondary text-base max-w-[600px]">{t('vdDesc')}</p>
      </div>

      <Card>
        <div className="mb-lg">
          <label className="block font-display text-xs font-medium text-text-secondary uppercase tracking-widest mb-sm">
            {t('examplePrompts')}
          </label>
          <ExamplePrompts onSelect={setInstruct} />
        </div>

        <FormTextarea
          label={t('voiceDescription')}
          value={instruct}
          onChange={(e) => setInstruct(e.target.value)}
          placeholder={t('voiceDescPlaceholder')}
          maxLength={1000}
        />

        <FormTextarea
          label={t('textToSynth')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('textPlaceholder')}
          maxLength={1000}
        />

        <FormSelect
          label={t('language')}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="Auto">{t('langAuto')}</option>
          <option value="Chinese">{t('langChinese')}</option>
          <option value="English">{t('langEnglish')}</option>
          <option value="Japanese">{t('langJapanese')}</option>
          <option value="Korean">{t('langKorean')}</option>
          <option value="German">{t('langGerman')}</option>
          <option value="French">{t('langFrench')}</option>
          <option value="Russian">{t('langRussian')}</option>
          <option value="Portuguese">{t('langPortuguese')}</option>
          <option value="Spanish">{t('langSpanish')}</option>
          <option value="Italian">{t('langItalian')}</option>
        </FormSelect>
        <div className="mb-lg" />

        <RangeSlider
          label={t('speed')}
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          min={0.5}
          max={2}
          step={0.1}
        />


        <FormSelect
          label="Ausgabe"
          value={deliveryMode}
          onChange={(e) => setDeliveryMode(e.target.value as 'wav' | 'stream')}
        >
          <option value="wav">WAV – vollständig speichern</option>
          <option value="stream">Live PCM – sofort abspielen</option>
        </FormSelect>
        <div className="mb-lg" />

        <Button
          variant="primary"
          isLoading={voiceDesignAudio.isLoading}
          loadingText={t('generating')}
          onClick={handleGenerate}
          className="w-full mt-lg"
        >
          <span>▶</span> {t('btnGenerateVoiceDesign')}
        </Button>
      </Card>

      <GenerationProgress active={voiceDesignAudio.isLoading} percent={progress.percent} label={progress.label} />

      <AudioPlayer audioUrl={voiceDesignAudio.url} metrics={voiceDesignAudio.metrics} title={t('generatedAudio')} />
    </div>
  );
}
