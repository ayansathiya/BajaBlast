import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IdleScene } from '../data/models';

interface Props {
  scenes: IdleScene[];
}

/**
 * Feature 20/7/16 — Apple-TV-inspired cinematic reel. Crossfades between
 * scenes with a slow ambient background drift; never a hard cut, never a
 * black screen. Loops indefinitely while idle.
 */
export function IdleReel({ scenes }: Props) {
  const [index, setIndex] = useState(0);
  // Identify scenes by content, not array reference — a parent re-render
  // that produces an equivalent-but-new array must never reset the reel.
  const sceneKey = scenes.map((s) => s.id).join('|');

  useEffect(() => {
    setIndex(0);
  }, [sceneKey]);

  useEffect(() => {
    if (scenes.length === 0) return;
    const scene = scenes[index % scenes.length];
    const t = setTimeout(() => setIndex((i) => (i + 1) % scenes.length), scene.durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, sceneKey]);

  if (scenes.length === 0) return null;
  const scene = scenes[index % scenes.length];

  return (
    <div className="idle-reel">
      <AnimatePresence mode="wait">
        <motion.div
          key={scene.id + index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0 }}
        >
          <div className={`idle-bg ${scene.background === 'photo' ? 'idle-bg-photo' : scene.background}`}>
            {scene.background === 'photo' && scene.imageUrl && (
              <>
                {/* Blurred fill behind, whole photo contained on top. */}
                <img src={scene.imageUrl} className="idle-photo-blur" alt="" aria-hidden />
                <img src={scene.imageUrl} className="idle-photo" alt="" />
              </>
            )}
          </div>
          <div className="idle-content" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: scene.background === 'photo' ? 'flex-end' : 'center', paddingBottom: scene.background === 'photo' ? 60 : 0 }}>
            {scene.background !== 'photo' && <div className="idle-eyebrow">{scene.kind.toUpperCase()}</div>}
            {scene.title && (
              <motion.div
                className={scene.background === 'photo' ? 'idle-photo-caption' : 'idle-title'}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 1.2, delay: 0.2 }}
              >
                {scene.title}
              </motion.div>
            )}
            {scene.subtitle && <div className="idle-subtitle">{scene.subtitle}</div>}
            {scene.detailLines?.map((line, i) => (
              <div className="idle-detail-line" key={i}>
                {line}
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="idle-progress">
        {scenes.map((s, i) => (
          <div key={s.id} className={`idle-progress-dot ${i === index % scenes.length ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  );
}
