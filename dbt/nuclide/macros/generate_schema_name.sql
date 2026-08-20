{#
  Use the custom schema name verbatim instead of dbt's default
  "<target_schema>_<custom_schema>" concatenation. Without this the marts land
  in "public_marts", which then has to be hardcoded into the API. With it the
  API reads from "marts", which is what the schema is actually called.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema | trim }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
