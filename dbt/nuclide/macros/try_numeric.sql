{#
  Safely cast a raw text column to numeric.

  The raw layer is all text on purpose, and several IAEA columns mix numbers
  with sentinels ("STABLE", "?", ""). A bare ::numeric would abort the whole
  model on a single bad row, so guard the cast with a regex and yield NULL
  instead. NULL here means "not a number", which the caller must interpret -
  it deliberately does not distinguish stable from unknown.
#}
{% macro try_numeric(column) %}
    case
        when {{ column }} ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
            then ({{ column }})::numeric
    end
{% endmacro %}
