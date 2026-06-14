"""Pure pattern-extraction functions — no DB, no side effects."""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations

import networkx as nx


def _get_parallel_rounds(steps: list[dict]) -> list[frozenset[str]]:
    """Return one frozenset of tool_names per topological generation."""
    if not steps:
        return []
    G = nx.DiGraph()
    for s in steps:
        G.add_node(s["id"], tool=s["tool_name"])
    for s in steps:
        for dep in s.get("dependencies", []):
            if dep in G:
                G.add_edge(dep, s["id"])
    rounds = []
    try:
        for generation in nx.topological_generations(G):
            tools = frozenset(G.nodes[n]["tool"] for n in generation)
            rounds.append(tools)
    except nx.NetworkXUnfeasible:
        pass
    return rounds


def extract_consistent_orderings(
    plans: list,
    min_frequency: float = 0.9,
) -> list[dict]:
    """Return hard_ordering candidates seen in >= min_frequency of plans.

    A (before, after) pair is counted whenever before_tool transitively
    precedes after_tool in the plan's step DAG.
    """
    n = len(plans)
    if n == 0:
        return []

    pair_counts: dict[tuple[str, str], int] = defaultdict(int)

    for row in plans:
        steps = row.steps or []
        if not steps:
            continue
        G = nx.DiGraph()
        for s in steps:
            G.add_node(s["id"], tool=s["tool_name"])
        for s in steps:
            for dep in s.get("dependencies", []):
                if dep in G:
                    G.add_edge(dep, s["id"])

        try:
            # Use transitive closure so A→B→C also counts A before C
            tc = nx.transitive_closure(G)
            id_to_tool = {s["id"]: s["tool_name"] for s in steps}
            for before_id, after_id in tc.edges():
                before_tool = id_to_tool.get(before_id)
                after_tool = id_to_tool.get(after_id)
                if before_tool and after_tool and before_tool != after_tool:
                    pair_counts[(before_tool, after_tool)] += 1
        except nx.NetworkXUnfeasible:
            continue

    results = []
    for (before_tool, after_tool), count in pair_counts.items():
        freq = count / n
        if freq >= min_frequency:
            results.append(
                {
                    "rule_type": "hard_ordering",
                    "before_tool": before_tool,
                    "after_tool": after_tool,
                    "frequency": round(freq, 4),
                    "sample_size": n,
                }
            )
    return results


def extract_parallel_patterns(
    plans: list,
    min_frequency: float = 0.8,
) -> list[dict]:
    """Return soft_parallel candidates seen in >= min_frequency of plans.

    A tool pair is included when both tools appear in the same parallel
    round in at least min_frequency of plans.
    """
    n = len(plans)
    if n == 0:
        return []

    pair_counts: dict[frozenset[str], int] = defaultdict(int)

    for row in plans:
        steps = row.steps or []
        rounds = _get_parallel_rounds(steps)
        for round_tools in rounds:
            if len(round_tools) >= 2:
                for pair in combinations(sorted(round_tools), 2):
                    pair_counts[frozenset(pair)] += 1

    results = []
    for pair_set, count in pair_counts.items():
        freq = count / n
        if freq >= min_frequency:
            tools = sorted(pair_set)
            results.append(
                {
                    "rule_type": "soft_parallel",
                    "tools": tools,
                    "frequency": round(freq, 4),
                    "sample_size": n,
                }
            )
    return results
