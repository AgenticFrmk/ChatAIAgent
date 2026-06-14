async def create_report(title: str = "Report", **kwargs) -> dict:
    """Create a report."""
    return {"report_id": "rpt_001", "title": title, "status": "created"}
