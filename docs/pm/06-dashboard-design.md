# Dashboard design

**What this is for:** Fix what the dashboard shows and how a reader interacts with it before the build is judged.
**Date:** 2026-09-20
**Status:** Draft

## Who reads it and when

Priya, the PM persona from the PRD, opens the dashboard on a Monday morning with about five minutes and one question in mind: is usage growing, what are people using the assistant for, or where is it failing. She reads one view, gets an answer with its caveat, and closes the tab.

## Information hierarchy

- Tiles answer "how much" in three seconds. A headline number needing no comparison is a stat tile, not a chart; a chart earns its place only for change, distribution, or composition.
- One chart per question. No chart carries two unrelated questions or uses two y-axes to fake that it does; two measures of different scale become two charts instead.
- Caveats are always visible, rendered as on-page text, never behind a link.
- Query is where everything else lives: any question the six fixed views did not anticipate, against the same aggregates.

## Views

**Overview.** "How much is happening, and is anyone coming back." Six tiles: conversations, turns, weeks covered, peak weekly pseudo-users, return rate for the latest complete week, intent coverage. Below, one line chart of weekly conversations by model, with a legend. Hover gives a tooltip on every point.

**Intensity.** "Is growth broad or concentrated, and did people come back." The return-rate line draws `NULL` weeks (no following week to measure) as gaps, not interpolated, and calls out the 2024 Q3 to Q4 persistence break rather than smoothing over it. A weekly pseudo-users line is colored along its length by top-10% share, one sequential ramp on a single axis. Conversations per pseudo-user shows p50 (solid) and p90 (dashed) in one color, named in the card note rather than a legend. A bar chart shows the share of pseudo-users active in more than one week, by quarter, surfacing the same break. Session depth is faceted by model family as small multiples. Tooltips on every mark; gaps never filled in.

**Intent.** "What are people trying to do." A 100% stacked area shows intent share by week; two more 100% stacked bar sets repeat the same ten classes by model family and by the top ten languages, each with a legend. Colors follow data order per chart in v1, so a class is not guaranteed the same color across charts; a fixed taxonomy-order color domain is planned polish. Labeling has not run on this build, so the view shows a "not available" card instead.

**Friction.** "Where is the assistant failing people." Four proxy rates over time (repeated request, correction follow-up, refusal, one-and-done) run as four lines with a legend, on a percent-formatted axis that autoscales to the data. A heatmap has the four signals on one axis and intent-and-model rows on the other, one sequential hue for the rate, never doubling as identity. A table below gives each intent's count and the same four rates with all models combined, so a striking percentage over a small denominator cannot be over-read. A proxy failing its 70% precision gate is dropped outright, not softened; with intent unlabeled, the heatmap and table fall back to "not available" while the weekly lines, which need no intent, still render.

**Data quality.** "How much to trust everything else." Tiles: minimum cell size (20), shards processed (86 of 86), taxonomy version, aggregate set size. Below: redaction and empty-input rate as two lines with a legend, on a percent-formatted axis; token-usage coverage over time, labeled with the window it covers from 2024-09-09; top-countries and top-languages bars, each with an explicit `suppressed_or_unknown` bar drawn like the others and named in the card note; a distinct muted tone for that row is planned polish.

**Query.** Whatever the other five views did not anticipate. A SQL textarea runs against the twelve committed aggregate views, capped at 200 rows, with a visible error line for a bad query. No chart here; it is the escape valve.

## Wireframes

At 400 px, tab pills wrap onto two or three rows, not a menu; tables scroll inside their card; charts scale to the card width.

**Overview, desktop.**
```
+---------------------------------------------+
| Loupe   [Overview][Intensity]...[Query]      |
| banner                                       |
+---------------------------------------------+
| [Convs][Turns][Weeks][Peak][Return][Intent]  |
+---------------------------------------------+
| weekly-convs-by-model line, legend           |
+---------------------------------------------+
| caveats, ODC-By                              |
+---------------------------------------------+
```

**Overview, 400 px.**
```
+----------------+
| Loupe          |
| [Ov][Int][Fr]  |
| [DQ][In][Qry]  |
| banner         |
+----------------+
| [Convs][Turns] |
| [Weeks][Peak]  |
| [Return][Int]  |
+----------------+
| chart, scaled  |
+----------------+
| caveats        |
+----------------+
```

**Friction, desktop.**
```
+---------------------------------------------+
| Loupe   [Overview]...[Friction]...[Query]    |
| banner                                       |
+---------------------------------------------+
| proxy-rates-over-time lines, legend          |
+---------------------------------------------+
| heatmap: x=4-signals, y=intent-model, ramp   |
+---------------------------------------------+
| table: intent, n, 4-rates (models-combined)  |
+---------------------------------------------+
| caveats, ODC-By                              |
+---------------------------------------------+
```

**Friction, 400 px.**
```
+----------------+
| Loupe          |
| [Ov][Int][Fr]  |
| [DQ][In][Qry]  |
| banner         |
+----------------+
| rates, legend  |
+----------------+
| heatmap scroll |
+----------------+
| table scroll   |
+----------------+
| caveats        |
+----------------+
```

## Interaction rules

Tooltips appear on every mark, on hover and on tap. Two or more series get a legend; the p50/p90 pair is distinguished by dash pattern and named in the card note (a legend is planned polish). Nothing animates: a static build regenerated by one batch command, at most weekly, so motion would imply a cadence the pipeline does not have. Color comes from the palette tokens. Rates use percent-formatted axes that autoscale to the data. Suppression is noted in the card note wherever `min_cell` applies. The suppressed_or_unknown row is drawn as an ordinary bar and named in the card note; a distinct muted tone is planned polish. Intent colors follow data order per chart in v1; a fixed taxonomy-order color domain is planned polish.

## Deliberately absent

- **Maps.** Small-cell suppression leaves most geographic cells too thin to show responsibly, and a map's precision invites over-reading exactly the cells it should hide.
- **Per-user tables.** A pseudo-user key is pseudonymous personal data; a row-scannable table defeats the aggregate-only design regardless of suppression above it.
- **Raw transcripts.** No row-level conversation content is served by the dashboard, and nothing links out to one.
- **Real time.** Aggregates regenerate from one batch command, never more often than weekly; a live indicator would promise a cadence the pipeline cannot keep.
- **Filters that would create small cells.** Any combination that could produce a cell under `min_cell` stays out; country and language show a fixed top set plus one residual, not an open filter.
