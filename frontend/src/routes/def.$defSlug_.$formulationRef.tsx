import { createFileRoute } from '@tanstack/react-router';
import DefinitionView from '../components/DefinitionView';

// /def/prf/game-based and the pinned /def/prf/game-based@r2 — what papers cite
export const Route = createFileRoute('/def/$defSlug_/$formulationRef')({
  validateSearch: (search): { macros?: string } => ({
    macros: typeof search.macros === 'string' ? search.macros : undefined,
  }),
  component: DefFormulationPage,
});

function DefFormulationPage() {
  const { defSlug, formulationRef } = Route.useParams();
  const { macros } = Route.useSearch();
  return <DefinitionView defSlug={defSlug} formulationRef={formulationRef} macros={macros} />;
}
