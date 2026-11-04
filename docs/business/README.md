# Business plan

`TouchGrass_Business_Plan.pdf`: business plan, revenue model, launch playbook, financial plan, ideas backlog.

The numbers come from one set of stated assumptions in `source/model.py`. To change an assumption and
rebuild the PDF (needs Python with `reportlab`; uses the Inter font from `node_modules`):

```bash
cd docs/business/source && python3 build.py ../TouchGrass_Business_Plan.pdf
```
