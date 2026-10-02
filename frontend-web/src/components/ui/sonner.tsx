import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Light theme only (theme.css), so no theme provider is needed.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      toastOptions={{
        classNames: {
          toast: '!border-border !bg-card !text-foreground !shadow-lg',
          actionButton: '!bg-primary !text-primary-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
