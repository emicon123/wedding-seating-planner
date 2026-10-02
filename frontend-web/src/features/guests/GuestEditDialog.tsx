import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { errorMessage } from '@/api/errorMessage'
import { useUpdateGuest } from '@/api/guests'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Guest } from '@/domain/types'

const schema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Wpisz imię.')
    .max(100, 'Imię może mieć najwyżej 100 znaków.'),
  lastName: z.string().trim().max(100, 'Nazwisko może mieć najwyżej 100 znaków.'),
  notes: z.string().max(2000, 'Notatka może mieć najwyżej 2000 znaków.'),
  isChild: z.boolean(),
})
type FormValues = z.infer<typeof schema>

type EditFormProps = {
  guest: Guest
  onSaved: () => void
  onConflict: () => void
  onCancel: () => void
}

function EditForm({ guest, onSaved, onConflict, onCancel }: EditFormProps) {
  const update = useUpdateGuest()
  const [failure, setFailure] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: guest.firstName,
      lastName: guest.lastName ?? '',
      notes: guest.notes,
      isChild: guest.isChild,
    },
  })

  const submit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      await update.mutateAsync({
        guestId: guest.id,
        version: guest.version,
        firstName: values.firstName,
        lastName: values.lastName === '' ? null : values.lastName,
        notes: values.notes,
        isChild: values.isChild,
      })
      toast.success('Zapisano zmiany.')
      onSaved()
    } catch (error) {
      if (error instanceof ApiError && error.has('version_conflict')) onConflict()
      else setFailure(errorMessage(error))
    }
  })

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-first-name">Imię</Label>
          <Input
            id="edit-first-name"
            autoComplete="off"
            aria-invalid={errors.firstName !== undefined}
            {...register('firstName')}
          />
          {errors.firstName && (
            <p role="alert" className="text-sm font-medium text-brick">
              {errors.firstName.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-last-name">Nazwisko (opcjonalnie)</Label>
          <Input
            id="edit-last-name"
            autoComplete="off"
            aria-invalid={errors.lastName !== undefined}
            {...register('lastName')}
          />
          {errors.lastName && (
            <p role="alert" className="text-sm font-medium text-brick">
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-notes">Notatka</Label>
        <Textarea id="edit-notes" placeholder="np. wegetarianin" {...register('notes')} />
        {errors.notes && (
          <p role="alert" className="text-sm font-medium text-brick">
            {errors.notes.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Controller
          control={control}
          name="isChild"
          render={({ field }) => (
            <Checkbox
              id="edit-is-child"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="edit-is-child">Dziecko</Label>
      </div>
      {failure && (
        <p role="alert" className="text-sm font-medium text-brick">
          {failure}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Anuluj
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          Zapisz
        </Button>
      </DialogFooter>
    </form>
  )
}

type GuestEditDialogProps = { guest: Guest; onClose: () => void }

/**
 * Edit sends the `version` it was opened on. When someone else saved first (409) the guest list
 * is reloaded by the hook, and the form is rebuilt from the fresh guest (the `key`) under a notice.
 */
export function GuestEditDialog({ guest, onClose }: GuestEditDialogProps) {
  const [conflict, setConflict] = useState(false)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj gościa</DialogTitle>
          <DialogDescription>{guest.displayName}</DialogDescription>
        </DialogHeader>
        {conflict && (
          <p
            role="alert"
            className="rounded-lg border border-brick/40 bg-brick/8 p-3 text-sm font-medium"
          >
            Ktoś zmienił tego gościa. Pokazuję aktualne dane, sprawdź je i zapisz jeszcze raz.
          </p>
        )}
        <EditForm
          key={guest.version}
          guest={guest}
          onSaved={onClose}
          onConflict={() => setConflict(true)}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
