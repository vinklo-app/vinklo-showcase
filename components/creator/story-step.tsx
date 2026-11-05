"use client";

/**
 * Paso opcional «Vuestra historia» (8-oct-2026): tres preguntas cortas que
 * se convierten en capítulos de la web (lib/creator-story.ts), con el texto
 * tal como lo escribís. Se salta con un toque; lo que quede en blanco no
 * crea capítulo.
 */
import { EMPTY_STORY, STORY_ANSWER_MAX, STORY_QUESTIONS } from "@/lib/creator-story";
import type { BuilderDraft } from "@/lib/wedding-builder";

export function StoryStep({ draft, onPatch, onSkip }: { draft: BuilderDraft; onPatch(values: Partial<BuilderDraft>): void; onSkip?(): void }) {
  const story = draft.story ?? EMPTY_STORY;
  return (
    <div className="wb-story">
      {STORY_QUESTIONS.map((item) => (
        <label key={item.id}>
          {item.question}
          <textarea rows={2} maxLength={STORY_ANSWER_MAX} value={story[item.id]} placeholder={item.placeholder} onChange={(event) => onPatch({ story: { ...story, [item.id]: event.target.value } })} />
        </label>
      ))}
      {onSkip && <button type="button" className="wb-secondary wb-skip" onClick={onSkip}>Saltar este paso</button>}
    </div>
  );
}
