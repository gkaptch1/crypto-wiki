import { createFileRoute } from '@tanstack/react-router';
import DefinitionView from '../components/DefinitionView';

export const Route = createFileRoute('/def/$defSlug')({
  validateSearch: (search): { macros?: string } => ({
    macros: typeof search.macros === 'string' ? search.macros : undefined,
  }),
  component: DefPage,
});

function DefPage() {
  const { defSlug } = Route.useParams();
  const { macros } = Route.useSearch();
  return <DefinitionView defSlug={defSlug} macros={macros} />;
}
