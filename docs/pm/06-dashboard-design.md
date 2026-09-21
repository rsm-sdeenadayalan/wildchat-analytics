# Dashboard design

**What this is for:** Fix what the dashboard shows, in what order, and how a reader interacts with it before the build is judged.
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

**Overview.** "How much is happening, and is anyone coming back." Six tiles: conversations, turns, weeks covered, peak weekly pseudo-users, return rate for the latest complete week, intent coverage. Below, one line chart of weekly conversations by model, colored in a fixed order kept consistent everywhere model appears. Hover gives a crosshair and tooltip; the legend is always shown.

**Intensity.** "Is growth broad or concentrated, and did people come back." The return-rate line draws `NULL` weeks (no following week to measure against) as gaps, not interpolated, and calls out the 2024 Q3 to Q4 persistence break rather than smoothing over it. A weekly pseudo-users line is colored along its length by top-10% share, one sequential ramp on a single axis. Conversations per pseudo-user shows p50 and p90 as two direct-labeled lines. A bar chart shows the share of pseudo-users active in more than one week, by quarter, surfacing the same break as a visible drop. Session depth is faceted by model family as small multiples. Tooltips on every mark; gaps never filled in.

**Intent.** "What are people trying to do." A 100% stacked area shows intent share by week; two more 100% stacked bar sets repeat the same ten classes by model family and by the top ten languages, all sharing one fixed color-to-class mapping so a class's color never changes meaning. Ten classes exceed the direct-label limit, so identity rests on an always-visible legend, not crowded labels. Labeling has not run on this build, so the view shows a "not available" card instead of fabricated shares.

**Friction.** "Where is the assistant failing people." Four proxy rates over time (repeated request, correction follow-up, refusal, one-and-done) run as four direct-labeled lines on a fixed 0 to 100% axis. A heatmap crosses intent by model family with one sequential hue for the rate, never doubling as identity. A conversation-weighted table below gives raw counts beside each rate, so a striking percentage over a small denominator cannot be over-read. A proxy failing its 70% precision gate is dropped outright, not softened; with intent unlabeled, the heatmap and the table's intent slice show "not available" while the weekly lines, which need no intent, still render.

**Data quality.** "How much to trust everything else." Tiles: minimum cell size (20), shards processed (86 of 86), taxonomy version, aggregate set size. Below: redaction rate and empty-input rate as two direct-labeled lines on a percent axis; token-usage coverage over time, labeled with the window it covers from 2024-09-09; top-countries and top-languages bars, each including an explicit `suppressed_or_unknown` bar in a muted status tone rather than a categorical hue, so it reads as "not a place," not one more country.

**Query.** Whatever the other five views did not anticipate. A SQL textarea runs against the twelve committed aggregate views, capped at 200 rows, with a visible error line for a bad query. No chart here; it is the escape valve, not a seventh visualization.

## Wireframes

**Overview, desktop.**
```
+---------------------------------------------+
| Loupe  tabs: Overview Intensity ... Query    |
| coverage banner                              |
+---------------------------------------------+
| [Convs][Turns][Weeks][Peak][Return][Intent]  |
+---------------------------------------------+
| weekly convs by model, line, legend          |
+---------------------------------------------+
| caveats | ODC-By                             |
+---------------------------------------------+
```

**Overview, 400 px.**
```
+----------------+
| Loupe    menu  |
| Overview  v    |
| banner         |
+----------------+
| [Convs]        |
| [Turns]        |
| [Weeks]        |
| [Peak]         |
| [Return]       |
| [Intent]       |
+----------------+
| chart, legend  |
+----------------+
| caveats        |
+----------------+
```

**Friction, desktop.**
```
+---------------------------------------------+
| Loupe  tabs: Overview ... Friction ... Query |
| coverage banner                              |
+---------------------------------------------+
| proxy rates, 4 lines, legend, percent axis   |
+---------------------------------------------+
| heatmap: intent rows x model cols, ramp key  |
+---------------------------------------------+
| weighted table: intent, model, N, 4 rates    |
+---------------------------------------------+
| caveats | ODC-By                             |
+---------------------------------------------+
```

**Friction, 400 px.**
```
+----------------+
| Loupe    menu  |
| Friction  v    |
| banner         |
+----------------+
| rates, legend  |
+----------------+
| heatmap        |
| (scrolls)      |
+----------------+
| table (stacked)|
+----------------+
| caveats        |
+----------------+
```

## Interaction rules

Tooltips appear on every mark, on hover and on tap. A legend is always shown for two or more series; a single-series chart names itself in the title instead. Nothing animates: a static build regenerated by one batch command, at most weekly, so motion would imply a cadence the pipeline does not have. Color comes from the palette tokens: categorical hues in a fixed order per entity, held constant across every view; one sequential ramp for magnitude; a muted status tone reserved for `suppressed_or_unknown`, never reused as a category. Every rate uses a percent axis, fixed 0 to 100%. Suppression is noted in the chart subtitle wherever `min_cell` applies, plus the residual bar in the country and language charts.

## Deliberately absent

- **Maps.** Small-cell suppression leaves most geographic cells too thin to show responsibly, and a map's precision invites over-reading exactly the cells it should hide.
- **Per-user tables.** A pseudo-user key is pseudonymous personal data; a row-scannable table defeats the aggregate-only design regardless of suppression above it.
- **Raw transcripts.** No row-level conversation content is served by the dashboard, and nothing links out to one.
- **Real time.** Aggregates regenerate from one batch command, never more often than weekly; a live indicator would promise a cadence the pipeline cannot keep.
- **Filters that would create small cells.** Any combination that could produce a cell under `min_cell` stays out; country and language show a fixed top set plus one residual, not an open filter.
