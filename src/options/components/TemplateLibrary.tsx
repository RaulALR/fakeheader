import type { SavedRuleTemplate } from '../../types/profile';
import { RULE_KIND_LABELS } from '../../rules/rule-display';
import { isSensitiveHeader } from '../../utils/sensitive';

export function TemplateLibrary({
  templates,
  onUse,
  onDelete,
}: {
  templates: SavedRuleTemplate[];
  onUse: (template: SavedRuleTemplate) => void;
  onDelete: (template: SavedRuleTemplate) => void;
}) {
  if (!templates.length)
    return (
      <section className="panel workspace-panel large-empty">
        <strong>No hay plantillas personalizadas.</strong>
        <p className="muted">
          Abre una regla y pulsa "Guardar como plantilla" para añadir la primera.
        </p>
      </section>
    );

  return (
    <div className="saved-template-grid">
      {templates.map((template) => {
        const rule = template.rule;
        const sensitive = rule.sensitive || isSensitiveHeader(rule.header ?? '');
        return (
          <article className="panel saved-template-card" key={template.id}>
            <div className="saved-template-heading">
              <span className={'rule-type-icon kind-' + (rule.kind ?? 'headers')}>
                {(rule.kind ?? 'headers').slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{template.name}</strong>
                <span>{RULE_KIND_LABELS[rule.kind ?? 'headers']}</span>
              </div>
            </div>
            <p className="muted">{template.description ?? 'Plantilla local de FakeHeader.'}</p>
            <div className="rule-tags">
              {rule.group && <span>{rule.group}</span>}
              {rule.tags?.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
              {sensitive && <span className="secret-badge">VALOR SECRETO EXCLUIDO</span>}
            </div>
            <div className="actions saved-template-actions">
              <button className="button small" onClick={() => onUse(template)}>
                Añadir al espacio de trabajo
              </button>
              <button className="button danger small" onClick={() => onDelete(template)}>
                Eliminar
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
