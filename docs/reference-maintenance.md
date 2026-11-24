# Maintain the public reference

Use [the public reference](reference/index.md) to find commands, toolkit
members, graph operations, and guides. From a checkout, use the same index
through the CLI.

```sh
node cli/ink-studio.js catalog coverage filter --all --full
node cli/ink-studio.js catalog raster.resize --all --json
node cli/ink-studio.js graph describe raster.resize --json
```

The generated pages live in `docs/reference/`. Source material for the
reference comes from the CLI's registered commands and usage, the package
entry points and loaded toolkit, the built-in graph operation catalog, and
the Markdown guides. The catalog also includes the curated feature notes
in `catalog.json`.

## Update a public tool

- Put CLI usage and options in the command's help.
- For a graph operation, define ports and defaults in the operation and provide
  a runnable catalog example.
- For a library feature, document the workflow and identify the qualified
  member name in a guide so the generated page can link to it.
- Run `npm run docs:build` and review the resulting reference changes with
  the implementation.

## Check the result

```sh
npm run docs:check
node --test tests/public-reference.test.js tests/graph-catalog.test.js
```

The check fails when generated files are missing, stale, or unexpectedly
left over, a local documentation link breaks, a registered command lacks
usage, or a stock graph operation lacks an example. The subcommand checks cover
the graph, patch, pixel-art, music, story, scene, and simulation dispatchers.
The graph tests run the examples against the operation registry.

The generator indexes guide headings and ties exported signatures to the
current JS. Review prose and behavioral examples when changing semantics,
even if the generated signatures still match.
