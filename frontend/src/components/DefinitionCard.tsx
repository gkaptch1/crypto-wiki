import type { ConcreteDefinition } from '../types/definition';
import MarkdownRenderer from './MarkdownRenderer';

interface DefinitionProps {
  def: ConcreteDefinition;
}

function DefinitionCard({ def }: DefinitionProps) {
  return (
    <div className="mt-4 p-4 rounded border">
      <h3 className="font-bold">{def.title}</h3>
      {def.categories.length > 0 && (
        <p className="italic text-sm text-gray-500">{def.categories.join(', ')}</p>
      )}
      <MarkdownRenderer content={def.bodyLatex} macros={def.macros} />
    </div>
  );
}

export default DefinitionCard;
