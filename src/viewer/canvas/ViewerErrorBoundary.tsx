"use client"

import { Component, type ReactNode } from "react"

interface Props {
  onError: () => void
  children: ReactNode
}

interface State {
  hasError: boolean
}

/** Catches render/load errors from the canvas subtree and notifies the host. */
export class ViewerErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(): void {
    this.props.onError()
  }

  override render(): ReactNode {
    return this.state.hasError ? null : this.props.children
  }
}
