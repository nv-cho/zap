from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

SECTIONS = {
    'services': ['Client need', 'Scope', 'Deliverables', 'Timeline', 'Pricing', 'Assumptions', 'Exclusions', 'Acceptance criteria'],
    'partnership': ['Objective', 'Benefits', 'Contributions', 'Responsibilities', 'Commercial arrangement', 'Next steps'],
}
class LineItem(BaseModel):
    description: str = Field(min_length=1, max_length=160)
    quantity: Decimal = Field(gt=0, le=10000, max_digits=10, decimal_places=2)
    unit_price: Decimal = Field(ge=0, le=1000000, max_digits=12, decimal_places=2)

class Experience(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    description: str = Field(min_length=1, max_length=2000)
    start_date: date
    end_date: date

    @model_validator(mode='after')
    def chronological(self):
        if self.end_date < self.start_date:
            raise ValueError('Experience end date must be on or after its start date.')
        return self

class Brief(BaseModel):
    kind: Literal['services', 'partnership'] = 'services'
    company: str = Field(default='', max_length=150)
    client: str = Field(default='', max_length=150)
    facts: str = Field(default='', max_length=12000)
    company_experience: list[Experience] = Field(default_factory=list, max_length=20)
    customer_id: str | None = None
    customer_context: str = Field(default='', max_length=12000)
    opportunity: str = Field(default='', max_length=5000)
    scope: str = Field(default='', max_length=3000)
    start_date: str = Field(default='', max_length=10)
    end_date: str = Field(default='', max_length=10)
    terms: str = Field(default='', max_length=3000)
    exclusions: str = Field(default='', max_length=2000)
    items: list[LineItem] = Field(default_factory=list, max_length=30)
    @model_validator(mode='after')
    def valid_dates(self):
        for v in [self.start_date, self.end_date]:
            if v:
                date.fromisoformat(v)
        return self

class Section(BaseModel):
    heading: str = Field(max_length=100)
    body: str = Field(max_length=8000)
    sources: list[str] = Field(default_factory=list, max_length=8)

class Draft(BaseModel):
    title: str = Field(max_length=200)
    summary: str = Field(max_length=3000)
    sections: list[Section] = Field(max_length=12)
    total: Decimal | None = None
    origin: Literal['crusoe', 'sample'] = 'crusoe'
    model: str = ''

class Review(BaseModel):
    brief: Brief
    draft: Draft

class Save(Review):
    proposal_id: str | None = None

class Export(Review):
    approved: bool = False

def line_total(item):
    return (item.quantity*item.unit_price).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)

def total(brief):
    return sum((line_total(x) for x in brief.items), Decimal('0')).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)

def money(value):
    return f'${Decimal(value).quantize(Decimal(".01"),rounding=ROUND_HALF_UP):,.2f}'

def questions(b):
    output = []
    for key, label in [('company','What is your company name?'),('client','Who is this proposal for?'),('facts','What approved company facts should we use?'),('opportunity','What does the client want to achieve?'),('scope','What deliverables or contributions are approved?'),('start_date','When does the work start?'),('end_date','When is the work due?'),('terms','What commercial terms have been approved?')]:
        if not getattr(b,key).strip(): output.append({'field':key,'question':label})
    if b.kind == 'services' and not b.exclusions.strip():
        output.append({'field':'exclusions','question':'What is excluded from the scope? Enter None if there are no exclusions.'})
    if b.kind == 'services' and not b.items:
        output.append({'field':'items','question':'What are the approved line items, quantities, and unit prices? Zero is valid for an explicitly free item.'})
    if b.start_date and b.end_date and b.end_date < b.start_date:
        output.append({'field':'end_date','question':'The deadline comes before the start date. What is the correct deadline?'})
    return output

def sources(b):
    company_text = b.facts
    if b.company_experience:
        company_text += '\n\nPast company experience:\n' + '\n'.join(f'{e.start_date} to {e.end_date}: {e.description}' for e in b.company_experience)
    return [{'id':'company','label':'Company knowledge','text':company_text}, {'id':'customer','label':'Customer context','text':b.customer_context}, {'id':'brief','label':'Opportunity brief','text':b.opportunity}, {'id':'scope','label':'Approved scope','text':b.scope}, {'id':'terms','label':'Commercial facts','text':b.terms}, {'id':'dates','label':'Approved dates','text':f'{b.start_date} to {b.end_date}'}, {'id':'exclusions','label':'Exclusions','text':b.exclusions}]

def validate(b,d):
    issues=[]
    def add(code,message,severity='error',section=None): issues.append({'code':code,'message':message,'severity':severity,'section':section})
    for q in questions(b): add('missing_fact',q['question'])
    expected=SECTIONS[b.kind]
    headings=[s.heading for s in d.sections]
    for heading in expected:
        if heading not in headings: add('missing_section',f'Add the {heading} section.',section=heading)
    if len(headings)!=len(set(headings)): add('duplicate_section','Duplicate proposal sections found.')
    if any(h not in expected for h in headings): add('unexpected_section','Proposal contains a section outside the selected template.')
    if b.kind=='services' and (d.total is None or d.total != total(b)):
        add('incorrect_total',f'Total must match approved line items: {money(total(b))}.',section='Pricing')
    if b.kind=='partnership' and d.total is not None: add('unexpected_total','Partnership pricing must come from approved commercial terms.')
    protected = protected_sections(b)
    for section in d.sections:
        if section.heading in protected and section.body.strip() != protected[section.heading][0].strip():
            add('commercial_changed','Commitment text differs from approved facts. Update the brief and regenerate.',section=section.heading)
    allowed_text=' '.join(source['text'] for source in sources(b))
    allowed_amounts={Decimal(n.replace(',','')) for n in re.findall(r'\$\s*([\d,]+(?:\.\d{1,2})?)',allowed_text)}
    allowed_amounts.update([total(b),*[x.unit_price for x in b.items],*[line_total(x) for x in b.items]])
    for heading, body, refs in [('Title',d.title,[]),('Summary',d.summary,[])]+[(s.heading,s.body,s.sources) for s in d.sections]:
        if not body.strip(): add('empty_section',f'{heading} is empty.',section=heading)
        if re.search(r'\b(TBD|TODO|UNRESOLVED)\b|\[NEEDS',body,re.I): add('unresolved',f'{heading} contains an unresolved field.',section=heading)
        for amt in re.findall(r'\$\s*([\d,]+(?:\.\d{1,2})?)',body):
            if Decimal(amt.replace(',','')) not in allowed_amounts: add('unsupported_amount',f'{heading} includes an unapproved amount: ${amt}.',section=heading)
        normalized_body=body.translate(str.maketrans({'‑':'-','–':'-','−':'-'}))
        for day in re.findall(r'\b\d{4}-\d{2}-\d{2}\b',normalized_body):
            if day not in allowed_text: add('unsupported_date',f'{heading} includes an unapproved date: {day}.',section=heading)
        for percent in re.findall(r'\b\d+(?:\.\d+)?%',body):
            if percent not in allowed_text: add('unsupported_percentage',f'{heading} includes an unapproved percentage: {percent}.',section=heading)
        if refs and any(x not in {s['id'] for s in sources(b)} for x in refs): add('unknown_source',f'{heading} references an unknown source.',section=heading)
        if heading in expected and not refs: add('no_source',f'{heading} has no source reference. Review its claims.','warning',heading)
    if re.search(r'ignore.{0,40}(instructions|rules)|system prompt|override.{0,30}rules',' '.join(source['text'] for source in sources(b)),re.I|re.S):
        add('source_instruction','Reference material contains instruction-like text. Treat it as untrusted and review the draft.','warning')
    return {'issues':issues,'passed':not any(i['severity']=='error' for i in issues),'expected_total':str(total(b)) if b.kind=='services' else None,'checks':['Required facts','Required sections','Unresolved fields','Line item arithmetic','Dollar amounts, ISO dates & percentages','Source references'],'note':'Checks are limited. Source labels are model-selected references, not verified entailment. A person must verify scope, claims, and commercial commitments.'}

def commercial_section(b):
    if b.kind=='services':
        lines=[f'{x.description}: {x.quantity} × {money(x.unit_price)} = {money(line_total(x))}' for x in b.items]
        return '\n'.join(lines+[f'Total: {money(total(b))}' if b.items else '[NEEDS APPROVED PRICING]',b.terms or '[NEEDS COMMERCIAL TERMS]'])
    return b.terms or '[NEEDS COMMERCIAL TERMS]'

def sample_brief(kind='services'):
    return Brief(kind=kind,company='Forma Studio',client='Northstar Coffee',customer_context='FICTIONAL DEMO CUSTOMER. Northstar Coffee is an independent coffee shop serving its local neighborhood. It sells coffee and light food and is preparing to open a second location.',facts='FICTIONAL DEMO COMPANY. Forma Studio is a four-person independent brand and web design studio. Services: brand strategy, visual identity, and marketing websites. Projects include two revision rounds. No sales or conversion guarantees. Client supplies final copy and photography.',opportunity='Northstar Coffee is opening its second location and needs a consistent brand and a simple website that helps customers explore the menu and find both shops.',scope='Brand discovery workshop; visual identity refresh; five-page marketing website; handoff guide. Client supplies approved copy and photos. Two revision rounds.' if kind=='services' else 'Co-host one brand workshop. Forma provides one designer and workshop materials. Northstar provides the venue, coffee, and attendee invitations.',start_date='2026-10-05',end_date='2026-10-30',terms='50% deposit; 50% on final approval. Two revision rounds included.' if kind=='services' else 'No fees or revenue sharing. Each partner covers its own costs. Both parties approve the event announcement.',exclusions='E-commerce, ongoing maintenance, paid advertising, and photography are excluded.',items=[LineItem(description='Brand identity refresh',quantity=1,unit_price=1800),LineItem(description='Marketing website',quantity=1,unit_price=3000)] if kind=='services' else [])

def sample_draft(b):
    bodies={'Client need':b.opportunity,'Scope':b.scope,'Deliverables':'A brand discovery workshop, refreshed visual identity, five-page marketing website, and handoff guide.','Timeline':f'Work begins {b.start_date} and ends {b.end_date}.','Pricing':commercial_section(b),'Assumptions':'Northstar supplies final copy and photography. Two revision rounds are included.','Exclusions':b.exclusions,'Acceptance criteria':'Review the deliverables against the approved scope. Specific acceptance criteria require human agreement.','Objective':b.opportunity,'Benefits':'A shared workshop introduces the studio and coffee shop to each other’s audiences. Attendance and commercial outcomes are not guaranteed.','Contributions':b.scope,'Responsibilities':b.scope,'Commercial arrangement':b.terms,'Next steps':f'Confirm the scope and commercial terms, then agree the event plan within {b.start_date} to {b.end_date}.'}
    refs={'Client need':['brief'],'Scope':['scope'],'Deliverables':['scope'],'Timeline':['dates'],'Pricing':['terms'],'Assumptions':['company'],'Exclusions':['exclusions'],'Acceptance criteria':['scope'],'Objective':['brief'],'Benefits':['brief'],'Contributions':['scope'],'Responsibilities':['scope'],'Commercial arrangement':['terms'],'Next steps':['dates','terms']}
    return Draft(title=f'{"Brand & website" if b.kind=="services" else "Community workshop"} proposal',summary='A considered next chapter for Northstar Coffee.' if b.kind=='services' else 'Bring design and coffee together through a shared community workshop.',sections=[Section(heading=h,body=protected_sections(b).get(h,(bodies[h],refs[h]))[0],sources=protected_sections(b).get(h,(bodies[h],refs[h]))[1]) for h in SECTIONS[b.kind]],total=total(b) if b.kind=='services' else None,origin='sample',model='Handwritten sample · no AI call')


def protected_sections(b):
    if b.kind == 'services':
        return {
            'Scope': (b.scope, ['scope']),
            'Deliverables': (b.scope, ['scope']),
            'Timeline': (f'Project start: {b.start_date}\nProject completion: {b.end_date}\nIntermediate milestones require agreement.', ['dates']),
            'Pricing': (commercial_section(b), ['terms']),
            'Assumptions': ('The approved scope and commercial terms define the commitments in this proposal. Any additional assumptions require explicit agreement before work begins.', ['scope','terms']),
            'Exclusions': (b.exclusions or '[NEEDS APPROVED EXCLUSIONS OR EXPLICIT NONE]', ['exclusions']),
            'Acceptance criteria': ('Suggested review process: compare the completed deliverables with the approved scope. Specific acceptance criteria and the approval process require agreement by both parties.', ['scope']),
        }
    return {
        'Contributions': (b.scope, ['scope']),
        'Responsibilities': ('Each party is responsible for its approved contributions:\n'+b.scope+'\nAny additional responsibilities require agreement.', ['scope']),
        'Commercial arrangement': (commercial_section(b), ['terms']),
    }
