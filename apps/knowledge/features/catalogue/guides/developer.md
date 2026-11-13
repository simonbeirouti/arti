# Maintaining the catalogue

`loadCatalogue` reads manifests and canonical guide sources. `validateCatalogue` checks stable IDs, dependencies, workflow/guide references and source/test existence. `publicCatalogue` applies audience filtering before publication or search.

Do not render source HTML or trust a guide path supplied through HTTP. Only registered repository-local paths are loaded. Both API and public knowledge renderer escape text.

Catalogue entries are definitions until a matching evidence run establishes verification. Do not change a guide to verified because a test filename exists.
