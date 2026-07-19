"use server"

import { revalidatePath } from "next/cache"

import { fieldErrorsOf, type FieldErrors } from "@/app/(auth)/schemas"
import {
  archiveProjectSchema,
  createProjectSchema,
  renameProjectSchema,
} from "@/app/(studio)/projects/schemas"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { createProject, renameProject, setProjectStatus } from "@/src/data/projects"
import { getRequestDb } from "@/src/data/supabaseClients"

export interface ProjectFormState {
  formError?: string
  fieldErrors?: FieldErrors
  done?: boolean
}

async function currentUserId(): Promise<string | null> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return null
  return user.value.userId
}

export async function createProjectAction(
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const parsed = createProjectSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) }
  const userId = await currentUserId()
  if (userId === null) return { formError: "You must be signed in." }
  const db = await getRequestDb()
  const result = await createProject(db, { userId, title: parsed.data.title })
  if (!result.ok) return { formError: result.error.message }
  revalidatePath("/projects")
  return { done: true }
}

export async function renameProjectAction(
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const parsed = renameProjectSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) }
  const userId = await currentUserId()
  if (userId === null) return { formError: "You must be signed in." }
  const db = await getRequestDb()
  const result = await renameProject(db, userId, parsed.data.id, parsed.data.title)
  if (!result.ok) return { formError: result.error.message }
  revalidatePath("/projects")
  return { done: true }
}

export async function archiveProjectAction(
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const parsed = archiveProjectSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) }
  const userId = await currentUserId()
  if (userId === null) return { formError: "You must be signed in." }
  const db = await getRequestDb()
  const result = await setProjectStatus(db, userId, parsed.data.id, "archived")
  if (!result.ok) return { formError: result.error.message }
  revalidatePath("/projects")
  return { done: true }
}
