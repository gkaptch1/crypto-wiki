import { useEffect, useState } from 'react';
import type { ConcreteDefinition } from '../types/definition';
import DefinitionCard from './DefinitionCard';
import MarkdownRenderer from './MarkdownRenderer';
import { createDefinition, getDefaultDefinitions } from '../api/definitions';

// Phase 0: create-only editor. Editing/deleting existing definitions comes with
// the Phase 1 editor rebuild (the backend endpoints don't exist yet).
function DefinitionsManager() {
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const [savedDefs, setSavedDefs] = useState<ConcreteDefinition[]>([]);
  const [macros, setMacros] = useState<Record<string, string>>({});
  const [macroKey, setMacroKey] = useState<string>('');
  const [macroValue, setMacroValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    getDefaultDefinitions()
      .then(setSavedDefs)
      .catch((e) => setError(e.message));
  };

  // fetch definitions from backend on component mount
  useEffect(reload, []);

  // Add or update a macro
  const handleAddMacro = () => {
    if (macroKey.trim()) {
      setMacros((prev) => ({
        ...prev,
        [macroKey]: macroValue,
      }));
      setMacroKey('');
      setMacroValue('');
    }
  };

  // Remove a macro
  const handleRemoveMacro = (key: string) => {
    setMacros((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  // save new definition
  const saveDef = async () => {
    setError(null);
    try {
      await createDefinition({
        title,
        categories: category.trim() ? [category.trim()] : [],
        bodyLatex: input,
        macros,
      });

      setTitle('');
      setCategory('');
      setInput('');
      setMacros({});
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save definition');
    }
  };

  return (
    <div className="p-4">
      {/* Macro Editor Section */}
      <div className="mt-4 p-3 bg-gray-100 rounded">
        <h3 className="font-bold mb-2">Macros</h3>
        <div className="flex gap-2 mb-2">
          <input
            value={macroKey}
            onChange={(e) => setMacroKey(e.target.value)}
            placeholder="Macro name (e.g., \secp)"
            className="border p-2 flex-1"
          />
          <input
            value={macroValue}
            onChange={(e) => setMacroValue(e.target.value)}
            placeholder="Macro value (e.g., \lambda)"
            className="border p-2 flex-1"
          />
          <button
            onClick={handleAddMacro}
            className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-700"
          >
            Add
          </button>
        </div>

        {/* Display added macros */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(macros).map(([key, value]) => (
            <div key={key} className="bg-white p-2 rounded border flex items-center gap-2">
              <span className="font-mono text-sm">
                {key} → {value}
              </span>
              <button
                onClick={() => handleRemoveMacro(key)}
                className="text-red-600 hover:text-red-800 font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <input
          value={title}
          placeholder="Definition title"
          type="text"
          onChange={(e) => setTitle(e.target.value)}
          className="border p-2 w-full mb-2"
        />
        <input
          value={category}
          placeholder="Category (optional)"
          type="text"
          onChange={(e) => setCategory(e.target.value)}
          className="border p-2 w-full mb-2"
        />

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="p-2 border-2 mr-2 w-full h-32 resize-y"
          placeholder="Enter Markdown and LaTeX content here..."
        />

        <button
          onClick={saveDef}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 active:bg-blue-800 mt-2"
        >
          Save Definition
        </button>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </div>

      <div className="mt-4">
        <h2 className="text-xl font-bold">Preview:</h2>
        <MarkdownRenderer content={input} macros={macros}></MarkdownRenderer>
      </div>

      {savedDefs.map((def) => (
        <DefinitionCard key={def.title} def={def} />
      ))}
    </div>
  );
}

export default DefinitionsManager;
