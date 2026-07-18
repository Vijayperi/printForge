import Link from "next/link"

import { Button } from "@/src/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <Card className="w-full max-w-xl text-center">
        <CardHeader>
          <CardTitle className="text-4xl tracking-tight">PrintForge</CardTitle>
          <CardDescription className="text-lg">
            Describe it. See it. We print it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center gap-4">
          <Button asChild>
            <Link href="/">Start creating</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">See examples</Link>
          </Button>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        The full landing page arrives in Session 2.
      </p>
    </main>
  )
}
