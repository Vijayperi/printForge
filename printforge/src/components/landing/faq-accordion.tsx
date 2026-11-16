import { Container, PageHeader, Section } from "@/src/components/layout/primitives"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/src/components/ui/accordion"
import { landingContent } from "@/src/config/content"

export function FaqAccordion() {
  return (
    <Section id="faq" className="bg-muted/40">
      <Container className="max-w-3xl space-y-8">
        <PageHeader title="Frequently asked questions" />
        <Accordion type="single" collapsible>
          {landingContent.faqs.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`}>
              <AccordionTrigger>{faq.question}</AccordionTrigger>
              <AccordionContent>{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </Section>
  )
}
