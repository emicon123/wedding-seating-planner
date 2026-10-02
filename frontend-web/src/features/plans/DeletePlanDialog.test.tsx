import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeletePlanDialog } from '@/features/plans/DeletePlanDialog'
import { evenPlan, threeScenarios } from '@/features/plans/fixtures'
import { makePlan, makeScenario } from '@/test/builders'

function setup(props: Partial<Parameters<typeof DeletePlanDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(
    <DeletePlanDialog
      scenarios={threeScenarios().slice(1, 2)}
      pending={false}
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  )
  return { user, onConfirm, onClose }
}

describe('DeletePlanDialog: one plan', () => {
  it('is an alertdialog that says what is cleared and that it cannot be undone', () => {
    setup()

    const dialog = screen.getByRole('alertdialog', { name: 'Usunąć plan na 10 miejsc?' })
    expect(dialog).toHaveAccessibleDescription(
      'Plan ma 3 stoły i 24 osoby przy stołach. Stoły znikną, wszyscy trafią do pola „Bez stołu”. Pinezki znikną. Tego nie da się cofnąć.',
    )
    expect(within(dialog).getByRole('button', { name: 'Usuń plan 10-osobowy' })).toBeEnabled()
  })

  it('puts the focus on the safe action, and Enter there cancels', async () => {
    const { user, onClose, onConfirm } = setup()

    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Esc cancels', async () => {
    const { user, onClose, onConfirm } = setup()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('the destructive button confirms, and does not close the dialog by itself', async () => {
    const { user, onConfirm, onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Usuń plan 10-osobowy' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('while pending: shows progress, ignores Esc, Anuluj and a second click', async () => {
    const { user, onConfirm, onClose } = setup({ pending: true })

    const busy = screen.getByRole('button', { name: /Usuwam/ })
    await user.click(busy)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Anuluj' }))

    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the failure inline, as an alert', () => {
    setup({ error: 'Coś poszło nie tak po stronie serwera.' })

    expect(screen.getByRole('alert')).toHaveTextContent('Coś poszło nie tak po stronie serwera.')
  })
})

describe('DeletePlanDialog: all plans', () => {
  const all = () => threeScenarios({ 12: makePlan([], []) })

  it('lists every plan, naming the empty one', () => {
    setup({ scenarios: all() })

    const dialog = screen.getByRole('alertdialog', { name: 'Usunąć wszystkie trzy plany?' })
    expect(
      within(dialog).getByText('Plan 8-osobowy: 3 stoły i 24 osoby przy stołach'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Plan 12-osobowy: bez stołów')).toBeInTheDocument()
  })

  it('keeps the destructive button disabled until the checkbox is ticked (keyboard works)', async () => {
    const { user, onConfirm } = setup({ scenarios: all() })
    const confirm = screen.getByRole('button', { name: 'Usuń wszystkie plany' })
    expect(confirm).toBeDisabled()

    await user.tab() // Anuluj -> checkbox
    expect(
      screen.getByRole('checkbox', { name: 'Rozumiem, że tego nie da się cofnąć' }),
    ).toHaveFocus()
    await user.keyboard(' ')

    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('focus starts on Anuluj here too', () => {
    setup({ scenarios: threeScenarios() })

    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveFocus()
  })

  it('a plan without tables still appears as a scenario of its own', () => {
    const empty = makeScenario(8, evenPlan(0, 0), 1)
    setup({ scenarios: [empty, ...threeScenarios().slice(1)] })

    expect(screen.getByText('Plan 8-osobowy: bez stołów')).toBeInTheDocument()
  })
})
