# Additional terms

CONCLAVE
Copyright (c) 2026 Nikita Tsyganov

CONCLAVE is free software under the GNU Affero General Public License, version 3, the whole text
of which is in [LICENSE](LICENSE). These are the additional terms that go with it.

They live in their own file because GitHub reads `LICENSE` to work out what a repository is
licensed under, and it matches that file against the known texts. Anything of ours in front of
the licence made it match nothing, so the repository reported no licence at all. Section 7
allows additional terms to be stated in a separate written licence, so that is what this is.

## Under section 7 of the License

In accordance with section 7 of the License, the following additional terms apply to this
program and to any covered work based on it:

**(a) Attribution (section 7(b)).** Every copy, modified version and covered work must
preserve the attribution "CONCLAVE by Nikita Tsyganov, https://github.com/nik1tsyganov/conclave" in
its README or equivalent documentation, in any user-visible credits, and in the copyright
notices of its source files.

**(b) Origin (section 7(c)).** Modified versions must be marked as modified and must not be
presented as the original CONCLAVE or as endorsed by, made by or affiliated with Nikita Tsyganov.

**(c) Names and marks (section 7(e)).** This License grants no rights to use the name
"CONCLAVE", the package name "conclave-mcp", or any other mark used by this project, with two
exceptions: preserving the attribution required above, and stating truthfully that other
software interoperates with, is built on, or is compatible with CONCLAVE. A modified version
may not take the name as its own product name, and may not use it in a way that suggests
endorsement or common origin.

The second exception is deliberate. A clause that forbade saying "works with CONCLAVE" would
not be enforceable and would punish the people this project wants: the ones building hosts
against it.

## Provenance

First published 2026-09-18. Three independent records carry that date, none of them ours to
rewrite: the commit history received by GitHub, the release tag `v0.1.0`, and the npm registry
entry for `conclave-mcp@0.1.0`, whose publish time is the registry's own.

The runtime existed before that under a previous name; that history is in this repository and
is dated by the same record.

## What this covers

The runtime in this repository: the dispatch tools, the policy and matrix files, the seat
skills, the agent and command definitions, the MCP server, the telemetry schemas and the site.

It covers the expression, not the idea. Anyone is free to build a tri-vendor review panel of
their own, and copyright would not stop them if we wanted it to. What these terms do reach is
narrower and worth being plain about: this code, whoever it travels to; the name, so a copy
cannot be sold as the original; the attribution, which every source file carries and which the
MCP server states to every host that connects; and section 13, which obliges anyone running a
modified version as a service to offer that modified source to the people using it.

A protocol is an idea and travels freely. An implementation is a work and does not.

## Why the AGPL and not something permissive

Section 13. Anyone who runs a modified CONCLAVE as a network service must offer that modified
source to its users. A permissive licence would let a copy be closed and sold on, which is the
one thing this licence is chosen to prevent.

The name is a common word for a sealed assembly that deliberates and votes, which is what this
runtime does. It is claimed as this project's mark in that field and nowhere else.
